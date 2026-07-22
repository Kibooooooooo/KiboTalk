import type { LlmClient, SttClient, CandidateStreamEvent } from '@kibotalk/pipeline'
import type { ConversationTurn, ReplyCandidate } from '@kibotalk/conversation'
import { encodeWav, padBuffer } from '@kibotalk/audio'
import { parseSseStream } from './sse'
import { extractCandidates } from './partial-json'
import { sttUrl } from './SttProviderSelect'
import { useConfig } from './config-store'

/**
 * Pipeline STT client that talks to the /stt proxy. The proxy holds the
 * provider key; the browser just ships WAV. `pcm` is the VAD-cut segment at
 * `sampleRate` (16kHz mono). Pre/post silence padding is applied here (ASR
 * preprocessing) so VAD cuts can stay tight (speechPadMs = 0). The provider
 * comes from the shared config store, so the live session honors the same
 * provider selection as the VAD panel.
 */
export class ProxySttClient implements SttClient {
  private prePadMs = 0;
  private postPadMs = 0;

  constructor(private sampleRate = 16000) {}

  /** Live-tune ASR-level padding without restarting the session. */
  configurePadding(prePadMs: number, postPadMs: number): void {
    this.prePadMs = prePadMs;
    this.postPadMs = postPadMs;
  }

  async transcribe(pcm: Float32Array, signal: AbortSignal): Promise<string> {
    const padded = padBuffer(pcm, this.prePadMs, this.postPadMs, this.sampleRate);
    const wav = encodeWav(padded, this.sampleRate);
    const res = await fetch(sttUrl(useConfig.getState().transcribeProvider), { method: 'POST', body: wav, signal });
    const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok) throw new Error(json.error ?? `STT HTTP ${res.status}`);
    return json.text ?? '';
  }
}

/**
 * Pipeline LLM client that talks to the /llm SSE proxy. The proxy renders the
 * reply-suggestions prompt and streams raw LLM JSON tokens; here we incrementally
 * parse the 3-candidate JSON array and map each completed candidate onto the
 * pipeline's CandidateStreamEvent (start → field deltas → done). Candidates
 * appear one-by-one as their objects complete in the stream.
 */
export class ProxyLlmClient implements LlmClient {
  constructor(
    private level = 'N5',
    private scene = '通用',
  ) {}

  configure(level: string, scene: string): void {
    this.level = level
    this.scene = scene
  }

  async *streamCandidates(
    context: ConversationTurn[],
    signal: AbortSignal,
  ): AsyncIterable<CandidateStreamEvent> {
    const res = await fetch('/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, level: this.level, scene: this.scene }),
      signal,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`LLM HTTP ${res.status} ${txt}`)
    }

    let raw = ''
    let emitted = 0
    for await (const msg of parseSseStream(res)) {
      if (msg.event === 'error') throw new Error(msg.data)
      if (msg.event !== 'token') continue
      raw += msg.data
      const complete = extractCandidates(raw)
      while (emitted < complete.length) {
        const c: ReplyCandidate = complete[emitted]
        const index = emitted
        yield { type: 'candidate-start', index }
        yield { type: 'candidate-delta', index, field: 'meaningZh', delta: c.meaningZh }
        yield { type: 'candidate-delta', index, field: 'targetText', delta: c.targetText }
        yield { type: 'candidate-delta', index, field: 'reading', delta: c.reading }
        yield { type: 'candidate-done', index, candidate: c }
        emitted++
      }
    }
    yield { type: 'done' }
  }
}
