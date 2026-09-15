/**
 * Step 1 of "Connect Slack": send the user to Slack's consent screen.
 *
 * Anti-forgery, matched to the origin:
 *  - always: the state parameter — a random value stored in a short-lived
 *    httpOnly cookie and checked in the callback, so a forged callback with
 *    someone else's authorization code cannot attach THEIR Slack to YOUR
 *    account;
 *  - https origins only: a PKCE verifier/challenge pair (S256). Slack treats
 *    a loopback redirect that uses PKCE as a "desktop redirect", and desktop
 *    redirects may not request bot scopes — so on localhost the challenge is
 *    omitted and the classic development exemption applies.
 */

import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth";
import {
  slackAuthorizeUrl,
  slackOAuthConfigured,
  slackRedirectUri,
  slackUsesPkce,
} from "@/lib/integrations/slack";

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/integrations", request.url));
  }

  const config = slackOAuthConfigured();
  if (!config) {
    // The deployment has no Slack app configured — the integrations page
    // explains what is missing rather than dead-ending here.
    return NextResponse.redirect(new URL("/integrations?slack=not_ready", request.url));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = slackRedirectUri(new URL(request.url).origin);
  const usePkce = slackUsesPkce();
  const verifier = usePkce ? randomBytes(32).toString("base64url") : null;
  const challenge = verifier
    ? createHash("sha256").update(verifier).digest("base64url")
    : null;

  const response = NextResponse.redirect(
    slackAuthorizeUrl({ clientId: config.clientId, redirectUri, state, codeChallenge: challenge }),
  );
  response.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    // Ten minutes: long enough to read Slack's consent screen, short enough
    // that a stale state is not replayable after the session moves on.
    maxAge: 600,
    path: "/",
  });
  if (verifier) {
    response.cookies.set("slack_oauth_verifier", verifier, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }
  return response;
}
