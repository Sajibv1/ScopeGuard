/**
 * The integration registry — what each §8 integration would need to run,
 * and the product promise it is constrained by.
 *
 * Scope of this file (deliberately narrow): these are SCAFFOLDS. Nothing here
 * talks to a third party, because none of the credentials exist yet — the
 * owner must create the OAuth apps / merchant accounts themselves. The
 * registry exists so the app can say, honestly and in one place:
 *
 *   - which integrations are planned,
 *   - exactly which credentials each one needs,
 *   - and which product promise each one is constrained by.
 *
 * Two rules keep the scaffolds honest:
 *
 *   1. No function pretends to work. Anything not configured returns
 *      { ok: false, reason: "not_configured" } with the env vars named —
 *      never a silent no-op and never a stubbed "success".
 *   2. "It never contacts your client" (README) is not negotiable. Gmail and
 *      Slack are delivery/notify surfaces for the OWNER — a Gmail
 *      integration creates drafts the owner sends themselves; a Slack
 *      integration posts to the owner's own channels. Neither ever messages
 *      a client. Automatic client messaging stays refused.
 */

export type IntegrationId = "gmail" | "slack" | "crm" | "payments";

export interface IntegrationSpec {
  id: IntegrationId;
  name: string;
  /** What it does once credentials exist. */
  purpose: string;
  /** Environment variables the owner must set to activate it. */
  credentials: string[];
  /** Where the owner obtains those credentials. */
  setup: string;
  /** The product promise this integration must not break. */
  constraint: string;
}

export const INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    id: "gmail",
    name: "Gmail",
    purpose:
      "Create a draft in your Gmail containing the reply text, ready for you to review and send yourself.",
    credentials: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"],
    setup:
      "Create an OAuth client in Google Cloud Console with the gmail.compose scope, and complete the consent flow once.",
    constraint:
      "ScopeGuard never contacts your client. The integration composes drafts — you press send, from your own account.",
  },
  {
    id: "slack",
    name: "Slack",
    purpose:
      "Connect your own workspace: when a change order is finalized, ScopeGuard posts it to a channel you choose, for your team to review.",
    credentials: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    setup:
      "The operator registers a Slack app (bot scopes chat:write, chat:write.public, channels:read; redirect URL <origin>/integrations/slack/callback) and sets the app credentials. Each user then clicks Connect Slack and authorizes their own workspace; their token is stored encrypted per user. An operator-wide SLACK_BOT_TOKEN + SLACK_NOTIFY_CHANNEL pair still works as the fallback for self-hosted single-workspace deployments.",
    constraint:
      "Notifications go to your team's channels only, through the acting user's own connection. The client is never messaged by any path in this product.",
  },
  {
    id: "crm",
    name: "CRM sync",
    purpose:
      "Push project and change-request references outward to your CRM so records stay aligned.",
    credentials: ["CRM_PROVIDER", "CRM_API_KEY"],
    setup: "Create an API key in your CRM (HubSpot, Pipedrive, …) with write access to deals.",
    constraint:
      "Outward sync of what you already decided. Nothing flows back in — the CRM can never edit a scope, an estimate, or an approval.",
  },
  {
    id: "payments",
    name: "Payments",
    purpose: "Link an approved invoice to a payment page you operate.",
    credentials: ["PAYMENTS_PROVIDER", "PAYMENTS_ACCOUNT_ID", "PAYMENTS_SECRET_KEY"],
    setup: "Create a merchant account with a payment provider and issue a restricted API key.",
    constraint:
      "ScopeGuard records hours and totals; it never moves money and never takes a fee. Amounts are human-entered by construction, and a payment link cannot change them — it can only reference the invoice document.",
  },
];

/** True when every env var the integration needs is present and non-empty. */
export function isConfigured(spec: IntegrationSpec): boolean {
  return spec.credentials.every((name) => (process.env[name] ?? "").trim() !== "");
}

export type IntegrationStatus = "configured" | "not_configured";

export function integrationStatuses(): Array<
  IntegrationSpec & { status: IntegrationStatus; missing: string[] }
> {
  return INTEGRATIONS.map((spec) => {
    const missing = spec.credentials.filter((name) => (process.env[name] ?? "").trim() === "");
    return { ...spec, status: missing.length === 0 ? "configured" : "not_configured", missing };
  });
}

/** The honest result type every integration returns. */
export type IntegrationResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: "not_configured" | "failed"; message: string };

/** The shared refusal: name the credentials, never fake success. */
export function notConfigured(spec: IntegrationSpec): {
  ok: false;
  reason: "not_configured";
  message: string;
} {
  return {
    ok: false,
    reason: "not_configured",
    message: `${spec.name} is not configured. Set ${spec.credentials.join(", ")} to activate it. ${spec.setup}`,
  };
}
