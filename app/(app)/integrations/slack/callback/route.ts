/**
 * Step 2 of "Connect Slack": Slack redirects back here with a one-time code.
 *
 * Verifies the state cookie, exchanges the code for the bot token (client
 * secret stays server-side), and stores the token encrypted, scoped to the
 * signed-in user. On any failure the user lands back on /integrations with
 * the reason in the query string — never a silent no-op.
 */

import { cookies } from "next/headers";

import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth";
import { saveSlackCredential } from "@/lib/data/integrations";
import { exchangeSlackCode, slackOAuthConfigured, slackRedirectUri, slackUsesPkce } from "@/lib/integrations/slack";

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/integrations", request.url));
  }

  const back = (detail: string) =>
    NextResponse.redirect(
      new URL(`/integrations?slack=error&detail=${encodeURIComponent(detail)}`, request.url),
    );

  const url = new URL(request.url);
  const slackError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (slackError) return back(slackError);
  if (!code || !state) return back("Slack did not return an authorization code.");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("slack_oauth_state")?.value;
  // Present only when the connect route issued one (https origins); absent
  // on the localhost dev exemption, where PKCE must not be used.
  const verifier = cookieStore.get("slack_oauth_verifier")?.value ?? null;
  if (!expectedState || expectedState !== state) {
    return back("The authorization state did not match. Start the connection again.");
  }

  const redirectUri = slackRedirectUri(new URL(request.url).origin);
  if (slackUsesPkce() && !verifier) {
    return back("The authorization session expired. Start the connection again.");
  }

  const config = slackOAuthConfigured();
  if (!config) return back("Slack sign-in is not configured on this deployment.");

  const grant = await exchangeSlackCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri,
    codeVerifier: verifier,
  });
  if (!grant.ok) return back(grant.message);

  await saveSlackCredential(user.id, {
    token: grant.token,
    teamName: grant.teamName,
    botUserId: grant.botUserId,
    slackUserId: grant.slackUserId,
  });

  const response = NextResponse.redirect(new URL("/integrations?slack=connected", request.url));
  response.cookies.delete("slack_oauth_state");
  response.cookies.delete("slack_oauth_verifier");
  return response;
}
