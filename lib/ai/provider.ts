/**
 * The single place ScopeGuard talks to a model.
 *
 * Responsibilities kept here so no caller can skip them (plan §5 safeguards):
 *  - server-only credentials
 *  - schema-validated output
 *  - bounded retry (exactly one, with the validation error fed back)
 *  - request timeouts
 *  - usage accounting with NO document text in the record
 *  - fixture mode when no key is configured
 *
 * There is deliberately no streaming and no tool calling: the model produces
 * structured data that the application then acts on. It never takes actions.
 */

import "server-only";

import { createHash } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

export type OperationKey = "extract" | "analyze" | "draft" | "breakdown" | "hours" | "legal";

const MODEL_ENV: Record<OperationKey, string> = {
  extract: "OPENAI_MODEL_EXTRACT",
  analyze: "OPENAI_MODEL_ANALYZE",
  draft: "OPENAI_MODEL_DRAFT",
  breakdown: "OPENAI_MODEL_DRAFT",
  hours: "OPENAI_MODEL_DRAFT",
  legal: "OPENAI_MODEL_DRAFT",
};

const DEFAULT_MODEL = "gpt-5.6-terra";
const REQUEST_TIMEOUT_MS = 90_000;
/** Whisper is the transcription model regardless of the chat model env vars. */
const TRANSCRIBE_MODEL = process.env.OPENAI_MODEL_TRANSCRIBE || "whisper-1";

export function isFixtureMode(): boolean {
  return !process.env.OPENAI_API_KEY;
}

export function modelFor(operation: OperationKey): string {
  return (
    process.env[MODEL_ENV[operation]] ||
    process.env.OPENAI_MODEL ||
    DEFAULT_MODEL
  );
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 2, // transport-level only; schema retries are handled below
    });
  }
  return client;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost, for the plan's "cost per workflow" metric. */
  costUsd: number | null;
  durationMs: number;
  attempts: number;
  /**
   * True when the result came from the cache rather than a model call.
   * Token counts are zero and attempts is 0 in that case.
   */
  cached?: boolean;
}

/**
 * Opt-in persistence for identical model calls, implemented by the caller
 * (lib/ai/model-cache.ts) and injected per generate() call. Kept as a pure
 * interface here because this module is also imported by the eval harness,
 * which runs under plain node with no request/session context.
 *
 * Only the sample seed passes a cache: its inputs are public compile-time
 * constants, so the first visitor's verified live output can safely serve
 * everyone after them. Real user documents are never cached.
 */
export interface ModelCache {
  get(key: string): Promise<unknown | null>;
  put(key: string, payload: unknown): Promise<void>;
}

export interface ModelResult<T> {
  data: T;
  model: string;
  usage: Usage;
  fixture: boolean;
}

export class ModelOutputError extends Error {
  // Written as an explicit field rather than a constructor parameter property:
  // Node's strip-only TypeScript mode does not support the shorthand, and this
  // module is imported by the eval harness running under plain `node`.
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "ModelOutputError";
    this.attempts = attempts;
  }
}

/** Published per-MTok pricing, used only for the eval report's cost column. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-5.6-sol": { input: 4, output: 20 },
  "gpt-5.6": { input: 4, output: 20 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

function estimateCost(model: string, input: number, output: number): number | null {
  const price = PRICING[model];
  if (!price) return null;
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;
}

export interface GenerateOptions<T> {
  operation: OperationKey;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  /** Deterministic stand-in used when no API key is configured. */
  fixture: () => T;
  /**
   * Extra validation beyond the schema — citation checks, monetary-claim
   * checks. Returning a string triggers the single retry with that string as
   * feedback. This is how "retry once with the validation error" (plan §6)
   * is implemented for content rules, not just shape rules.
   */
  validate?: (data: T) => string | null;
  /** When set, a verified result is read from / written to this cache. */
  cache?: ModelCache;
}

/**
 * Run one AI operation and return validated data.
 *
 * When options.cache is set (sample seed only), a previously verified result
 * for the identical call is served from it — after re-validation — and a
 * newly verified result is written back. The model is still the source of
 * truth: the cache only ever holds output that passed the checks above.
 *
 * Throws ModelOutputError when output is still invalid after the retry. The
 * caller records a failed analysis_run and shows a review-required result —
 * it must never fall back to fabricated content.
 */
export async function generate<T>(options: GenerateOptions<T>): Promise<ModelResult<T>> {
  const started = Date.now();

  if (isFixtureMode()) {
    const data = options.fixture();
    return {
      data,
      model: "fixture",
      fixture: true,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        attempts: 1,
      },
    };
  }

  const model = modelFor(options.operation);
  const openai = getClient();

  // zod 4 emits draft-2020-12 with `additionalProperties: false` and every
  // property in `required`, which is exactly what OpenAI strict mode demands,
  // so no conversion helper is needed.
  const jsonSchema = z.toJSONSchema(options.schema, { target: "draft-2020-12" });

  // The key covers every input to the call, so a prompt, model, or document
  // change can never serve a stale answer. Derived here rather than by the
  // caller so the two can never disagree about what identifies a call.
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([
        options.operation,
        model,
        options.system,
        options.user,
        options.schemaName,
      ]),
    )
    .digest("hex");

  if (options.cache) {
    const cache = options.cache;
    const cached = await quietly(() => cache.get(cacheKey), null);

    // A cached payload is never trusted as-is: it goes through the SAME
    // schema parse and validate() (citation checks against the source text)
    // as a live response. A row that fails either — poisoned, stale, or
    // written against a different document — is treated as a miss.
    if (cached !== null) {
      const parsed = parseModelJson(cached, options.schema);
      if (parsed.ok && options.validate?.(parsed.data) == null) {
        return {
          data: parsed.data,
          model,
          fixture: false,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: Date.now() - started,
            attempts: 0,
            cached: true,
          },
        };
      }
    }
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let feedback: string | null = null;
  let lastError = "Model returned no parsable output.";

  // One initial attempt plus exactly one retry. Bounded, per plan §5.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent: string = feedback
      ? `${options.user}\n\nYour previous response was rejected: ${feedback}\nProduce a corrected response that fixes this.`
      : options.user;

    const response = await openai.responses.create({
      model,
      input: [
        { role: "system", content: options.system },
        { role: "user", content: userContent },
      ],
      text: {
        format: {
          type: "json_schema",
          name: options.schemaName,
          strict: true,
          schema: jsonSchema as Record<string, unknown>,
        },
      },
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    if (response.status === "incomplete") {
      lastError = `Response was cut off (${response.incomplete_details?.reason ?? "unknown reason"}).`;
      feedback = lastError;
      continue;
    }

    // Strict mode guarantees the shape, but we re-validate anyway: a refusal,
    // a truncated payload, or a future API change should surface as a failed
    // run, not as undefined fields flowing into the database.
    const parsedResult = safeParseJson(response.output_text, options.schema);
    if (!parsedResult.ok) {
      lastError = parsedResult.error;
      feedback = lastError;
      continue;
    }

    const problem = options.validate?.(parsedResult.data);
    if (problem) {
      lastError = problem;
      feedback = problem;
      continue;
    }

    // Persist only output that passed verification — a cached entry is a
    // record of a verified result, never of a rejected one. Best-effort: a
    // cache write failure must not fail an otherwise successful run.
    if (options.cache) {
      const cache = options.cache;
      await quietly(() => cache.put(cacheKey, parsedResult.data), undefined);
    }

    return {
      data: parsedResult.data,
      model,
      fixture: false,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCost(model, inputTokens, outputTokens),
        durationMs: Date.now() - started,
        attempts: attempt,
      },
    };
  }

  throw new ModelOutputError(lastError, 2);
}

type ParseOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

/** Run the schema half of parsing on an already-decoded JSON value. */
function parseModelJson<T>(json: unknown, schema: z.ZodType<T>): ParseOutcome<T> {
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `Response did not match the required schema — ${issues}` };
  }

  return { ok: true, data: result.data };
}

function safeParseJson<T>(text: string | undefined, schema: z.ZodType<T>): ParseOutcome<T> {
  if (!text || text.trim() === "") {
    return { ok: false, error: "Model returned an empty response." };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Model returned text that is not valid JSON." };
  }

  return parseModelJson(json, schema);
}

/** Best-effort wrapper for cache access: a cache failure only costs speed. */
async function quietly<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch {
    return fallback;
  }
}

// ── Audio transcription (plan §10, Tier 1) ───────────────────────────────────

export interface TranscriptionSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  /** ISO language code Whisper detected, when it reports one. */
  language: string | null;
  /** Length of the audio in seconds, as Whisper measured it. */
  durationSec: number;
  model: string;
}

/**
 * Transcribe an audio or video file into timed segments.
 *
 * This is the one model call in the product that is not a generate(): there
 * is no JSON schema to validate and no judgement in the output — just the
 * segments Whisper heard, which the user then reviews cue by cue before any
 * of it can become scope. The transcription is never trusted directly; it is
 * material for the human review screen, same as OCR output.
 */
export async function transcribeAudio(file: File): Promise<TranscriptionResult> {
  const transcription = await getClient().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "verbose_json",
  });

  const segments: TranscriptionSegment[] = [];
  if ("segments" in transcription && Array.isArray(transcription.segments)) {
    for (const segment of transcription.segments) {
      const text = String(segment.text ?? "").trim();
      if (!text) continue;
      segments.push({
        startSec: Number(segment.start) || 0,
        endSec: Number(segment.end) || 0,
        text,
      });
    }
  }

  return {
    segments,
    language: "language" in transcription ? String(transcription.language ?? "") || null : null,
    durationSec: Number("duration" in transcription ? transcription.duration : 0) || 0,
    model: TRANSCRIBE_MODEL,
  };
}
