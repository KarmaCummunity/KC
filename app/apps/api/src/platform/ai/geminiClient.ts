// One way to call Google Gemini for every feature that needs a model answer
// (translation, post import, match ranking). A feature owns its prompt and
// what it makes of the answer; the call itself (key, retry, timeout, the
// response envelope) is here once.

const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
/** Transient statuses worth one quick retry: rate limit and upstream failures. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Why a call gave no usable answer.
 * `not_configured`: no API key. `http`: the provider refused. `timeout`: it was too slow.
 * `unreachable`: no connection. `bad_response`: the answer was not the JSON asked for.
 */
export type GeminiFailure = 'not_configured' | 'http' | 'timeout' | 'unreachable' | 'bad_response';

/** A Gemini call failed. The message never holds the key or the text that was sent. */
export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiFailure,
    message: string,
    /** The HTTP status, for `http` failures. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiRequest {
  /** The fixed rules of the task. Member-supplied text never goes here. */
  readonly systemInstruction: string;
  /** The user turn: the data to work on. */
  readonly userText: string;
  /** Constrains the answer's shape (Gemini's OpenAPI subset); omitted: any JSON. */
  readonly responseSchema?: object;
}

export interface GeminiClientOptions {
  /** The API key, or null when none is configured (every call then fails as `not_configured`). */
  readonly apiKey: string | null;
  readonly model: string;
  /** A call slower than this is aborted. */
  readonly timeoutMs?: number;
  /** Wait before the one retry. */
  readonly retryDelayMs?: number;
  readonly fetch?: typeof fetch;
  /** Replaced in tests so they do not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The model's JSON out of the API envelope. */
function parseEnvelope(body: string): unknown {
  try {
    const envelope = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = envelope.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') throw new Error('no text part');
    return JSON.parse(text);
  } catch {
    throw new GeminiError('bad_response', 'gemini answered with something that is not the expected JSON');
  }
}

export class GeminiClient {
  /** The model id, stored by callers as provenance of an answer. */
  readonly model: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GeminiClientOptions) {
    this.model = options.model;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Asks for a deterministic (temperature 0) JSON answer.
   * @returns The model's JSON, parsed but not validated: the caller owns the contract.
   * @throws GeminiError on every failure; a transient refusal is retried once first.
   */
  async generateJson(request: GeminiRequest): Promise<unknown> {
    const { apiKey } = this.options;
    if (!apiKey) throw new GeminiError('not_configured', 'GEMINI_API_KEY is not set');
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: request.userText }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
      },
    });

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.send(apiKey, body);
      if (response.ok) return parseEnvelope(await response.text());
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 1) {
        throw new GeminiError('http', `gemini http ${response.status}`, response.status);
      }
      await this.sleep(this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }

  private async send(apiKey: string, body: string): Promise<Response> {
    try {
      return await this.fetch(ENDPOINT(this.model), {
        method: 'POST',
        // The key travels in a header, never in the URL, so it cannot reach a log line.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GeminiError(timedOut ? 'timeout' : 'unreachable', timedOut ? 'gemini timed out' : 'gemini unreachable');
    }
  }
}
