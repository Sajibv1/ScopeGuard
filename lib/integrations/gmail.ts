/**
 * Gmail integration scaffold (§8, honest version).
 *
 * Two distinct surfaces, deliberately separated:
 *
 *   - `gmailComposeUrl` works TODAY with no credentials: it opens the user's
 *     own Gmail compose window pre-filled with the reply. The user reviews
 *     and presses send. Nothing is transmitted by ScopeGuard — the browser
 *     navigates, the user acts. This is the credential-free version of
 *     "email integration" and it is the whole feature until OAuth exists.
 *
 *   - `createGmailDraft` is the OAuth-backed surface: it would insert a
 *     DRAFT into the user's Gmail via the Gmail API. It stays a scaffold —
 *     until the credentials exist it refuses with the env vars named, and
 *     even when configured it creates drafts, never sends. Automatic client
 *     messaging remains refused (README: "It never contacts your client").
 */

import { INTEGRATIONS, notConfigured, type IntegrationResult } from "./registry.ts";

/** The compose window the owner's browser opens — they press send. */
export function gmailComposeUrl(input: {
  to: string;
  subject: string;
  body: string;
}): string {
  // Gmail's compose endpoint takes standard query params; encodeURIComponent
  // handles the multi-line reply body. `su` is the subject, `body` the text.
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: input.to,
    su: input.subject,
    body: input.body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** A plain mailto fallback for owners without Gmail open in a browser. */
export function mailtoUrl(input: { to: string; subject: string; body: string }): string {
  const params = new URLSearchParams({
    subject: input.subject,
    body: input.body,
  });
  return `mailto:${input.to}?${params.toString()}`;
}

export interface GmailDraft {
  /** The draft id Gmail assigned. */
  draftId: string;
}

/**
 * Insert a DRAFT into the user's Gmail (never send).
 *
 * SCAFFOLD: refuses until the OAuth credentials exist. When they do, this
 * function gains the Gmail API call — insert as the authenticated user, with
 * the same reply text `gmailComposeUrl` pre-fills, and no send anywhere.
 */
export async function createGmailDraft(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<IntegrationResult<GmailDraft>> {
  const spec = INTEGRATIONS.find((integration) => integration.id === "gmail")!;
  return notConfigured(spec);
}
