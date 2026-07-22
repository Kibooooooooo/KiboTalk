import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSttClient, sttConfigFromEnv } from "../src/index";

function mockResponse(text: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal",
    json: async () => ({ text }),
  } as unknown as Response;
}

describe("createSttClient (openrouter adapter)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to /audio/transcriptions with Bearer auth and WAV base64 payload", async () => {
    const mockFetch = vi.fn(async () => mockResponse("hello world"));
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const client = createSttClient({
      provider: "openrouter",
      baseUrl: "https://openrouter.example.com",
      apiKey: "secret",
      model: "openai/gpt-4o-transcribe",
    });

    const wav = new ArrayBuffer(10);
    const text = await client.transcribe(wav);
    expect(text).toBe("hello world");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("https://openrouter.example.com/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer secret");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeUndefined();

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("openai/gpt-4o-transcribe");
    expect(body.input_audio.format).toBe("wav");
    const expectedBase64 = btoa(
      String.fromCharCode(...new Uint8Array(10)),
    );
    expect(body.input_audio.data).toBe(expectedBase64);
  });

  it("returns the transcription text from the mocked response", async () => {
    globalThis.fetch = vi.fn(async () => mockResponse("the quick brown fox")) as unknown as typeof globalThis.fetch;
    const client = createSttClient({
      provider: "openrouter",
      baseUrl: "https://x.example",
      apiKey: "k",
      model: "m",
    });
    expect(await client.transcribe(new ArrayBuffer(4))).toBe("the quick brown fox");
  });

  it("passes the AbortSignal through to fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return mockResponse("");
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const client = createSttClient({
      provider: "openrouter",
      baseUrl: "https://x.example",
      apiKey: "k",
      model: "m",
    });
    await expect(
      client.transcribe(new ArrayBuffer(2), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("throws on unknown provider", () => {
    expect(() =>
      createSttClient({ provider: "nope", baseUrl: "x", apiKey: "y", model: "z" }),
    ).toThrow(/unknown stt provider/i);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn(async () => mockResponse("", false)) as unknown as typeof globalThis.fetch;
    const client = createSttClient({
      provider: "openrouter",
      baseUrl: "https://x.example",
      apiKey: "k",
      model: "m",
    });
    await expect(client.transcribe(new ArrayBuffer(2))).rejects.toThrow(/STT request failed/);
  });
});

describe("sttConfigFromEnv", () => {
  it("returns factory args for the active provider group", () => {
    const config = sttConfigFromEnv({
      STT_ACTIVE: "openrouter",
      STT_OPENROUTER_BASE_URL: "https://openrouter.example.com",
      STT_OPENROUTER_API_KEY: "secret",
      STT_OPENROUTER_MODEL: "openai/gpt-4o-transcribe",
    });
    expect(config).toEqual({
      provider: "openrouter",
      baseUrl: "https://openrouter.example.com",
      apiKey: "secret",
      model: "openai/gpt-4o-transcribe",
    });
  });

  it("falls back to the provider default model when env model is absent", () => {
    const config = sttConfigFromEnv({
      STT_ACTIVE: "openrouter",
      STT_OPENROUTER_BASE_URL: "https://x.example",
      STT_OPENROUTER_API_KEY: "k",
    });
    expect(config.model).toBe("openai/gpt-4o-transcribe");
  });

  it("throws a clear error for an unknown active provider", () => {
    expect(() => sttConfigFromEnv({ STT_ACTIVE: "foo" })).toThrow(
      /unknown stt provider/i,
    );
  });

  it("throws a clear error when the active group is incomplete", () => {
    expect(() =>
      sttConfigFromEnv({
        STT_ACTIVE: "openrouter",
        STT_OPENROUTER_BASE_URL: "https://x.example",
      }),
    ).toThrow(/missing stt config/i);
  });

  it("throws when STT_ACTIVE is unset", () => {
    expect(() => sttConfigFromEnv({})).toThrow(/STT_ACTIVE is not set/i);
  });
});
