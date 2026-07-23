import { cwd } from 'node:process'

import { defineConfig, loadEnv, requiredEnvFrom } from 'vieval'
import { chatModelFrom, ChatModels } from 'vieval/plugins/chat-models'

const env = loadEnv('test', cwd(), '')
const deepseekModel = env.LLM_OPENAI_MODEL ?? 'deepseek-v4-flash'

/**
 * Reply-suggestions prompt ablation.
 *
 * runMatrix: generator model × promptVariant (production-like: thinking off)
 * evalMatrix: judge model with thinking on (DeepSeek V4 CoT for rubric quality)
 */
export default defineConfig({
  concurrency: {
    case: 2,
    task: 1,
  },
  env,
  plugins: [
    ChatModels({
      models: [
        chatModelFrom({
          aliases: ['reply-agent'],
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'LLM_OPENAI_API_KEY',
            type: 'string',
          }),
          baseURL: config =>
            config.env.LLM_OPENAI_BASE_URL ?? 'https://api.deepseek.com',
          inferenceExecutor: 'openai',
          model: deepseekModel,
          timeout: 120_000,
        }),
        chatModelFrom({
          aliases: ['judge'],
          apiKey: config => requiredEnvFrom(config.env, {
            name: 'LLM_OPENAI_API_KEY',
            type: 'string',
          }),
          autoRetry: 2,
          baseURL: config =>
            config.env.LLM_OPENAI_BASE_URL ?? 'https://api.deepseek.com',
          inferenceExecutor: 'openai',
          model: deepseekModel,
          timeout: 180_000,
        }),
      ],
    }),
  ],
  projects: [
    {
      include: ['evals/*.eval.ts'],
      name: 'reply-suggestions',
      root: '.',
      runMatrix: {
        extend: {
          model: ['reply-agent'],
          promptVariant: [
            'baseline',
            'system_split',
            'ruby_kanji_only',
            'no_phrase_reading',
            'ruby_kanji_no_phrase',
            'particle_ruby_strict',
          ],
        },
      },
      evalMatrix: {
        extend: {
          rubric: ['strict'],
          rubricModel: ['judge'],
        },
      },
    },
  ],
})
