/**
 * Provider-agnostic STT client. The factory takes config and returns a client
 * whose interface (`transcribe`) contains no provider specifics. Adding a new
 * provider = adding a new adapter + an env group; no changes to the factory
 * interface or other adapters.
 */

export interface SttClientConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TranscribeOptions {
  signal?: AbortSignal;
  /** Optional language hint (e.g. "ja", "en"). Honored by OpenAI-compatible
   * servers (mlx-qwen3-asr, vLLM, Groq); ignored by the OpenRouter adapter. */
  language?: string;
}

export interface SttClient {
  transcribe(audio: ArrayBuffer, opts?: TranscribeOptions): Promise<string>;
}

interface SttAdapter {
  transcribe(audio: ArrayBuffer, opts: TranscribeOptions): Promise<string>;
}

type AdapterFactory = (config: SttClientConfig) => SttAdapter;

interface AdapterRegistration {
  factory: AdapterFactory;
  defaults?: { model?: string };
}

const adapters: Record<string, AdapterRegistration> = {};

export function registerAdapter(
  provider: string,
  factory: AdapterFactory,
  defaults?: { model?: string },
): void {
  adapters[provider] = { factory, defaults };
}

export function createSttClient(config: SttClientConfig): SttClient {
  const registration = adapters[config.provider];
  if (!registration) {
    throw new Error(`Unknown STT provider: ${config.provider}`);
  }
  const adapter = registration.factory(config);
  return {
    transcribe: (audio, opts) => adapter.transcribe(audio, opts ?? {}),
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function createOpenRouterAdapter(config: SttClientConfig): SttAdapter {
  return {
    async transcribe(audio, opts) {
      const base64 = arrayBufferToBase64(audio);
      // OpenRouter audio transcription request. If the exact field name changes,
      // adjust only this single object literal — nothing in the interface.
      const body = JSON.stringify({
        model: config.model,
        input_audio: {
          format: "wav",
          data: base64,
        },
      });
      const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: opts.signal,
      });
      if (!response.ok) {
        throw new Error(
          `STT request failed: ${response.status} ${response.statusText}`,
        );
      }
      const json = (await response.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}

registerAdapter("openrouter", createOpenRouterAdapter, {
  model: "openai/gpt-4o-transcribe",
});

/**
 * Standard OpenAI-compatible multipart adapter. POSTs the WAV as
 * `multipart/form-data` (`file` + `model` + optional `language`) to
 * `${baseUrl}/audio/transcriptions` and returns `response.text`. Works with
 * any OpenAI Whisper-compatible server: mlx-qwen3-asr (`serve`), vLLM, Groq,
 * real OpenAI. This is the path used for local low-latency STT.
 */
function createOpenAiCompatAdapter(config: SttClientConfig): SttAdapter {
  return {
    async transcribe(audio, opts) {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
      form.append("model", config.model);
      if (opts.language) form.append("language", opts.language);
      const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: opts.signal,
      });
      if (!response.ok) {
        throw new Error(
          `STT request failed: ${response.status} ${response.statusText}`,
        );
      }
      const json = (await response.json()) as { text?: string };
      return json.text ?? "";
    },
  };
}

registerAdapter("openai", createOpenAiCompatAdapter, {
  model: "Qwen/Qwen3-ASR-1.7B",
});

/**
 * Pure helper that reads `STT_ACTIVE` plus the active provider's env group
 * (`STT_<PROVIDER>_BASE_URL`, `STT_<PROVIDER>_API_KEY`, `STT_<PROVIDER>_MODEL`)
 * and returns factory args. Falls back to the provider's registered default
 * model when `STT_<PROVIDER>_MODEL` is absent. Throws clear errors on missing
 * active provider or missing required env values.
 */
export function sttConfigFromEnv(
  env: Record<string, string | undefined>,
): SttClientConfig {
  const provider = env.STT_ACTIVE;
  if (!provider) {
    throw new Error("STT_ACTIVE is not set");
  }
  const registration = adapters[provider];
  if (!registration) {
    throw new Error(`Unknown STT provider: ${provider}`);
  }
  const prefix = `STT_${provider.toUpperCase()}_`;
  const baseUrl = env[`${prefix}BASE_URL`];
  const apiKey = env[`${prefix}API_KEY`];
  const model = env[`${prefix}MODEL`] ?? registration.defaults?.model;
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      `Missing STT config for provider "${provider}": need ${prefix}BASE_URL, ${prefix}API_KEY, and ${prefix}MODEL`,
    );
  }
  return { provider, baseUrl, apiKey, model };
}
