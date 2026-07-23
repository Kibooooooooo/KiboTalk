import { describeTask } from 'vieval'
import { modelFromEval, modelFromRun } from 'vieval/plugins/chat-models'

import { caseToPromptArgs, RUBY_FOCUS_CASES } from './fixtures/cases'
import { chatWithModel, extractJsonValue, type ChatCallResult } from './lib/chat'
import {
  buildJudgeUserPayload,
  JUDGE_SYSTEM,
  normalizeJudgeVerdict,
} from './lib/judge'
import { validateReplyCandidates } from './lib/schema'
import {
  buildPromptVariant,
  type PromptVariant,
} from './lib/variants'

function recordUsageMetrics(
  metric: (name: string, value: string | number | boolean | null) => void,
  prefix: 'agent' | 'judge',
  call: ChatCallResult,
) {
  metric(`${prefix}.latency_ms`, call.latencyMs)
  metric(`session.${prefix}.raw_text`, call.text)
  if (call.reasoningText) metric(`session.${prefix}.reasoning_text`, call.reasoningText)
  const usage = call.usage
  if (!usage) return
  if (usage.prompt_tokens != null) metric(`${prefix}.prompt_tokens`, usage.prompt_tokens)
  if (usage.completion_tokens != null) metric(`${prefix}.completion_tokens`, usage.completion_tokens)
  if (usage.total_tokens != null) metric(`${prefix}.total_tokens`, usage.total_tokens)
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
  if (reasoningTokens != null) metric(`${prefix}.reasoning_tokens`, reasoningTokens)
}

describeTask('reply-suggestions-ruby-ablation', ({ casesFromInputs }) => {
  casesFromInputs(
    'reply',
    RUBY_FOCUS_CASES,
    async (context) => {
      const { matrix, metric, score } = context
      const fixture = matrix.inputs
      const variant = String(
        context.task.matrix.run.promptVariant ?? 'baseline',
      ) as PromptVariant
      const rubric = String(context.task.matrix.eval.rubric ?? 'strict')

      metric('benchmark.case.id', fixture.id)
      metric('prompt.variant', variant)
      metric('case.level', fixture.level)
      metric('case.note', fixture.note)
      metric('eval.rubric', rubric)

      const agentModel = modelFromRun(context, { axis: 'model' })
      const judgeModel = modelFromEval(context, { axis: 'rubricModel' })
      const promptArgs = caseToPromptArgs(fixture)
      const built = await buildPromptVariant(variant, promptArgs)

      metric('session.agent.prompt', built.promptText)
      metric('session.agent.messages_json', JSON.stringify(built.messages))

      const caseStartedAt = Date.now()

      const agent = await chatWithModel(context, agentModel, built.messages, {
        thinking: 'disabled',
        label: 'reply-agent',
      })
      metric('agent.thinking', 'disabled')
      recordUsageMetrics(metric, 'agent', agent)

      let parsed: unknown
      try {
        parsed = extractJsonValue(agent.text)
      }
      catch (error) {
        metric('schema.parse_error', String(error))
        score(0, 'exact')
        throw error
      }

      const schema = validateReplyCandidates(parsed, built.schema)
      metric('schema.ok', schema.ok)
      metric('schema.errors_json', JSON.stringify(schema.errors))
      metric('schema.annotation_issues_json', JSON.stringify(schema.annotationIssues))
      metric('schema.kana_over_ruby_rate', schema.kanaOverRubyRate)
      metric('schema.particle_miss_rate', schema.particleMissRate)
      metric('session.agent.parsed_json', JSON.stringify(schema.candidates))
      score(schema.score, 'exact')
      if (!schema.ok) metric('schema.soft_fail', true)

      const judgeMessages = [
        { role: 'system' as const, content: JUDGE_SYSTEM },
        {
          role: 'user' as const,
          content: buildJudgeUserPayload({
            rubric,
            level: fixture.level,
            context: promptArgs.context,
            suggestions: schema.candidates,
            schemaErrors: schema.errors,
            annotationIssues: schema.annotationIssues,
            kanaOverRubyRate: schema.kanaOverRubyRate,
            particleMissRate: schema.particleMissRate,
            promptVariant: variant,
          }),
        },
      ]
      metric('session.judge.prompt', JSON.stringify(judgeMessages))

      const judge = await chatWithModel(context, judgeModel, judgeMessages, {
        thinking: 'enabled',
        label: 'judge',
      })
      metric('judge.thinking', 'enabled')
      recordUsageMetrics(metric, 'judge', judge)

      const verdict = normalizeJudgeVerdict(extractJsonValue(judge.text))
      metric('judge.reason', verdict.reason)
      if (verdict.annotationNotes) metric('judge.annotation_notes', verdict.annotationNotes)
      metric('judge.dim.level_fit', verdict.dimensions.level_fit)
      metric('judge.dim.naturalness', verdict.dimensions.naturalness)
      metric('judge.dim.diversity', verdict.dimensions.diversity)
      metric('judge.dim.usefulness', verdict.dimensions.usefulness)
      metric('judge.dim.furigana_quality', verdict.dimensions.furigana_quality)
      metric('judge.dim.particle_quality', verdict.dimensions.particle_quality)
      metric('judge.dim.schema_faithfulness', verdict.dimensions.schema_faithfulness)
      score(verdict.score, 'judge')

      metric('case.total_latency_ms', Date.now() - caseStartedAt)
      metric('case.agent_plus_judge_ms', agent.latencyMs + judge.latencyMs)
    },
    { concurrency: 2 },
  )
}, {
  concurrency: { case: 2 },
  description:
    'Furigana/助詞-focused prompt ablation; exact schema + DSV4 thinking judge',
})
