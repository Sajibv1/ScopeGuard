/**
 * Product limits (plan §3).
 *
 * These are product decisions that keep processing predictable, not claims
 * about model capability. They live in their own module because both server
 * data code and client form components need them, and the data layer is
 * server-only.
 */

/** Longest scope document we accept. Over-length input is rejected, never truncated. */
export const SCOPE_TEXT_LIMIT = 40_000;

/** Longest client message we accept. */
export const CLIENT_MESSAGE_LIMIT = 20_000;

/** Largest PDF upload, in bytes. */
export const PDF_SIZE_LIMIT = 10 * 1024 * 1024;

/**
 * Most pages OCR will attempt. Rasterising and recognising a page costs
 * hundreds of milliseconds each, so a scan is capped rather than left to run
 * for minutes inside a request. Pages beyond the cap are reported as
 * truncated, never silently dropped.
 */
export const OCR_MAX_PAGES = 20;

/**
 * Below this per-page confidence the transcription is flagged for extra
 * attention during human review. It is a triage signal, not an acceptance
 * gate: no OCR text becomes a baseline without review regardless of score.
 */
export const OCR_MIN_CONFIDENCE = 75;

/**
 * Largest audio/video upload accepted for transcription, in bytes. This is
 * the OpenAI transcription API's own ceiling — larger files are refused with
 * a pointer to the paste tab rather than trimmed.
 */
export const AUDIO_SIZE_LIMIT = 25 * 1024 * 1024;

/**
 * Largest screenshot accepted for text recognition, in bytes. Screenshots of
 * a chat are small; anything near this size is a full-screen photo that
 * recognition would struggle with anyway.
 */
export const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;
