/**
 * Slack integration (§8) — per-user OAuth, with an operator-wide fallback.
 *
 * Posts to a channel when a change order is finalized, so the user's own team
 * sees what is ready for review. This is an internal notification surface
 * only: the client is never a recipient of anything this product sends,
 * because nothing is ever sent to a client (README: "It never contacts your
 * client").
 *
 * Two configuration layers, in precedence order:
 *
 *  1. The USER'S OWN connection — they click "Connect Slack", authorize via
 *     OAuth, and pick a channel. The bot token is stored encrypted per user
 *     (migration 0007) and only ever used for their own notifications.
 *     Requires the deployment to hold a Slack app's SLACK_CLIENT_ID and
 *     SLACK_CLIENT_SECRET.
 *
 *  2. The operator-wide env pair (self-hosted, single-workspace deployments):
 *     SLACK_BOT_TOKEN + SLACK_NOTIFY_CHANNEL. Used only when the acting user
 *     has no connection of their own.
 *
 * Until one of these exists, notifySlack refuses with what is missing —
 * never a silent no-op, never a fake success.
 */

import { INTEGRATIONS, notConfigured, type IntegrationResult } from "./registry.ts";

function slackSpec() {
  return INTEGRATIONS.find((integration) => integration.id === "slack")!;
}

/**
 * The Slack Web API endpoint. Read at call time (not import time) so tests
 * can point it at a local server via SLACK_API_URL / SLACK_OAUTH_URL /
 * SLACK_CHANNELS_URL.
 */
function slackApiUrl(): string {
  return process.env.SLACK_API_URL ?? "https://slack.com/api/chat.postMessage";
}

function slackOAuthTokenUrl(): string {
  return process.env.SLACK_OAUTH_URL ?? "https://slack.com/api/oauth.v2.access";
}

function slackChannelsUrl(): string {
  return process.env.SLACK_CHANNELS_URL ?? "https://slack.com/api/conversations.list";
}

// ── Operator-wide env configuration ─────────────────────────────────────────

/**
 * The operator-wide env credential, when both vars are set. Used only when
 * the acting user has no connection of their own.
 */
export function slackEnvCredential(): { token: string; channel: string } | null {
  const token = (process.env.SLACK_BOT_TOKEN ?? "").trim();
  const channel = (process.env.SLACK_NOTIFY_CHANNEL ?? "").trim();
  return token !== "" && channel !== "" ? { token, channel } : null;
}

// ── OAuth (per-user connections) ────────────────────────────────────────────

/** The Slack app credentials a deployment needs to offer "Connect Slack". */
export function slackOAuthConfigured(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.SLACK_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SLACK_CLIENT_SECRET ?? "").trim();
  return clientId !== "" && clientSecret !== "" ? { clientId, clientSecret } : null;
}

/**
 * The redirect URI for both legs of the OAuth flow. It must match the Slack
 * app's configured Redirect URLs byte-for-byte, so it is pinned to the
 * canonical site origin (NEXT_PUBLIC_SITE_URL — localhost in dev, the https
 * origin in production) rather than derived from the request: a user
 * reaching the app via a LAN IP or a tunnel would otherwise silently send a
 * URI Slack refuses (only https URLs and the localhost development exemption
 * are valid redirect URLs). The request origin is only the fallback when no
 * site URL is configured.
 */
export function slackRedirectUri(fallbackOrigin: string): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const origin = site !== "" ? site : fallbackOrigin.replace(/\/+$/, "");
  return `${origin}/integrations/slack/callback`;
}

/**
 * Whether to send PKCE parameters. Default OFF, deliberately:
 *
 * Slack classifies a redirect to a loopback host (localhost, 127.0.0.1) as a
 * "desktop redirect" when PKCE is in play, and desktop redirects may never
 * request bot scopes — which is why local development must use a non-loopback
 * hostname (see README: "Local development and Slack OAuth"). For a proper
 * https origin PKCE is *optional* ("your app may use the PKCE arguments"),
 * and sending it to an app that has not enabled the PKCE setting can itself
 * be rejected — so it is opt-in via SLACK_OAUTH_PKCE=true, for deployments
 * whose Slack app has the setting enabled. The state cookie guards every
 * flow regardless.
 */
export function slackUsesPkce(): boolean {
  return (process.env.SLACK_OAUTH_PKCE ?? "").trim().toLowerCase() === "true";
}

export function slackAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    // chat:write posts; chat:write.public lets the bot post to public
    // channels without an invite (a user connecting their own workspace
    // should not have to find the bot and invite it first); channels:read
    // lists public channels for the picker.
    scope: "chat:write,chat:write.public,channels:read",
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  if (input.codeChallenge) {
    params.set("code_challenge", input.codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export interface SlackOAuthGrant {
  token: string;
  teamName: string | null;
  botUserId: string | null;
  slackUserId: string | null;
}

/**
 * Exchange a temporary authorization code for the bot token, per Slack's
 * oauth.v2.access. The client secret — and the PKCE verifier, when one was
 * issued — never leave the server.
 */
export async function exchangeSlackCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string | null;
}): Promise<IntegrationResult<SlackOAuthGrant>> {
  const form = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier) form.set("code_verifier", input.codeVerifier);

  let response: Response;
  try {
    response = await fetch(slackOAuthTokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: `The token exchange request did not go out: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    team?: { name?: string };
    bot_user_id?: string;
    authed_user?: { id?: string };
  } | null;

  if (!response.ok || !body || body.ok !== true || !body.access_token) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    return {
      ok: false,
      reason: "failed",
      message: `Slack rejected the authorization code: ${detail}`,
    };
  }

  return {
    ok: true,
    token: body.access_token,
    teamName: body.team?.name ?? null,
    botUserId: body.bot_user_id ?? null,
    slackUserId: body.authed_user?.id ?? null,
  };
}

export interface SlackChannel {
  id: string;
  name: string;
  isMember: boolean;
}

/** Public channels in the connected workspace, for the channel picker. */
export async function listSlackChannels(input: {
  token: string;
}): Promise<IntegrationResult<{ channels: SlackChannel[] }>> {
  let response: Response;
  try {
    response = await fetch(slackChannelsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ types: "public_channel", limit: "200" }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: `The channel list request did not go out: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    channels?: Array<{ id: string; name: string; is_member?: boolean }>;
  } | null;

  if (!response.ok || !body || body.ok !== true || !body.channels) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    return {
      ok: false,
      reason: "failed",
      message: `Slack would not list the channels: ${detail}`,
    };
  }

  const channels = body.channels
    .map((channel) => ({ id: channel.id, name: channel.name, isMember: channel.is_member ?? false }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, channels };
}

// ── Posting ─────────────────────────────────────────────────────────────────

export interface SlackNotification {
  channel: string;
  /** Slack's message timestamp — the id of the posted message. */
  ts: string;
}

/**
 * Post one message to a channel.
 *
 * The token comes from the acting user's own connection (`input.token`) or,
 * when they have none, the operator-wide env pair. Slack answers most
 * failures with HTTP 200 and `{ok: false, error: …}` — both that shape and
 * transport/HTTP errors return `{ok: false, reason: "failed"}` with the
 * detail in the message, so callers can report it.
 */
export async function notifySlack(input: {
  channel: string;
  text: string;
  token?: string;
}): Promise<IntegrationResult<SlackNotification>> {
  const token = (input.token ?? process.env.SLACK_BOT_TOKEN ?? "").trim();
  if (!token) return notConfigured(slackSpec());

  let response: Response;
  try {
    response = await fetch(slackApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: input.channel, text: input.text }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      message: `The Slack request did not go out: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    channel?: string;
    ts?: string;
  } | null;

  if (!response.ok || !body || body.ok !== true) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    return {
      ok: false,
      reason: "failed",
      message: `Slack rejected the message: ${detail}`,
    };
  }

  return { ok: true, channel: body.channel ?? input.channel, ts: body.ts ?? "" };
}

/** The message posted when a change order is finalized. */
export function changeOrderReadyText(input: {
  projectName: string;
  reference: string;
  documentsUrl: string;
}): string {
  return (
    `${input.reference} in ${input.projectName} is finalized and ready to send. ` +
    `Review it before it goes out: ${input.documentsUrl}`
  );
}
