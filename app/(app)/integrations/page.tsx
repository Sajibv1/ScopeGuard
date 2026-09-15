import { ButtonLink, Card, Notice, PageHeader } from "@/components/ui";
import { MailOpen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSlackCredential } from "@/lib/data/integrations";
import { integrationStatuses } from "@/lib/integrations/registry";
import { listSlackChannels, slackEnvCredential, slackOAuthConfigured } from "@/lib/integrations/slack";
import type { SlackChannel } from "@/lib/integrations/slack";

import { IntegrationIcon } from "./integration-icon";
import { FutureIntegrations } from "./future-integrations";
import { SlackConnectionCard } from "./slack-card";

export const metadata = { title: "Integrations" };

/**
 * The integrations page (§8).
 *
 * Slack is the one integration users connect THEMSELVES — a real OAuth flow,
 * a token stored encrypted per user, a channel they choose. Gmail / CRM /
 * payments are scaffolded honestly: the page names exactly what each needs
 * before it activates, and an unconfigured integration is shown as
 * unconfigured, never as working.
 *
 * One distinction is stated plainly because it matters for multi-user
 * deployments: a user's own connection is theirs alone, while env-var
 * credentials are the OPERATOR's and apply to every user of the deployment
 * who has not connected their own.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/integrations");
  const params = await searchParams;
  const statuses = integrationStatuses().filter((integration) => integration.id !== "slack");

  const credential = await getSlackCredential(user.id);
  const oauth = slackOAuthConfigured();
  const envSlack = slackEnvCredential();

  let channels: SlackChannel[] = [];
  let channelListFailed: string | null = null;
  if (credential) {
    const listed = await listSlackChannels({ token: credential.token });
    if (listed.ok) channels = listed.channels;
    else channelListFailed = listed.message;
  }

  const banner = slackBanner(params);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect ScopeGuard to the tools you already use. Slack connects through your own account; the others list what they need before they activate."
      />

      <Notice tone="info" className="mb-4" title="ScopeGuard never contacts your client">
        <p>
          Email and messaging integrations are delivery surfaces for <strong>you</strong>:
          Gmail composes drafts you send yourself, Slack posts to your own channels. No
          integration in this product ever messages a client, and none ever changes a figure
          you entered.
        </p>
      </Notice>

      {banner ? <div className="mb-4">{banner}</div> : null}

      {credential ? (
        <SlackConnectionCard
          teamName={credential.teamName}
          channel={credential.channel}
          channels={channels}
          channelListFailed={channelListFailed}
          connectedAt={credential.connectedAt}
        />
      ) : (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <IntegrationIcon id="slack" />
              <h2 className="text-sm font-semibold text-foreground">Slack</h2>
            </div>
            {oauth ? (
              <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                not connected
              </span>
            ) : (
              <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                unavailable
              </span>
            )}
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Connect your own Slack workspace: when you finalize a change order, ScopeGuard posts
            it to a channel you choose, through your connection, for your team to review.
          </p>

          {oauth ? (
            <div className="mt-3">
              <ButtonLink href="/integrations/slack/connect">Connect Slack</ButtonLink>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                You will approve the connection on Slack&rsquo;s own consent screen. The bot token
                is stored encrypted, scoped to your account, and can be deleted here at any time.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Slack sign-in is not set up on this deployment yet — the operator needs to register
              a Slack app and set <span className="font-mono">SLACK_CLIENT_ID</span> and{" "}
              <span className="font-mono">SLACK_CLIENT_SECRET</span>.
            </p>
          )}

          {envSlack ? (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Until you connect your own, this deployment falls back to an operator-configured
              channel (<span className="font-mono">{envSlack.channel}</span>): your finalized
              change orders post there. Connecting your own Slack replaces that for you.
            </p>
          ) : null}
        </Card>
      )}

      <FutureIntegrations>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {statuses.map((integration) => (
            <Card key={integration.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <IntegrationIcon id={integration.id} />
                <h2 className="text-sm font-semibold text-foreground">{integration.name}</h2>
              </div>
              {integration.status === "configured" ? (
                <span className="rounded border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-xs text-ok">
                  credentials present
                </span>
              ) : (
                <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                  not configured
                </span>
              )}
            </div>

            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {integration.purpose}
            </p>

            <div className="mt-3 space-y-2 text-xs">
              <div>
                <h3 className="font-semibold text-foreground">To activate</h3>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  {integration.setup}
                </p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {integration.credentials.map((name) => {
                    const missing = integration.missing.includes(name);
                    return (
                      <li
                        key={name}
                        className={`rounded border px-1.5 py-0.5 font-mono text-xs ${
                          missing
                            ? "border-border text-muted-foreground"
                            : "border-ok/40 text-ok"
                        }`}
                      >
                        {/* Present/missing must survive greyscale, not colour alone. */}
                        <span aria-hidden className="mr-1">
                          {missing ? "✗" : "✓"}
                        </span>
                        {name}
                        <span className="sr-only">{missing ? " (missing)" : " (set)"}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">What it will never do</h3>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">
                  {integration.constraint}
                </p>
              </div>
            </div>
            </Card>
          ))}
        </div>
      </FutureIntegrations>

      <Card className="mt-4 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary"
          >
            <MailOpen className="size-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Works today, no credentials</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              On the documents screen, &ldquo;Open in Gmail&rdquo; opens a compose window in
              <strong> your</strong> Gmail with the reply text pre-filled. It is a link your
              browser follows — ScopeGuard transmits nothing, and you press send.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

/**
 * Outcome banners for the OAuth round trip. The detail string comes back in
 * the query string and is reflected, not trusted — it is displayed as text.
 */
function slackBanner(params: Record<string, string | string[] | undefined>) {
  const flag = params.slack;
  const detail = typeof params.detail === "string" ? params.detail : null;

  if (flag === "connected") {
    return (
      <Notice tone="success" title="Slack connected">
        <p>Choose a channel below to finish setting up your notifications.</p>
      </Notice>
    );
  }

  if (flag === "error") {
    return (
      <Notice tone="danger" title="Connecting Slack failed">
        <p>{detail ?? "Slack did not complete the authorization."}</p>
      </Notice>
    );
  }

  if (flag === "not_ready") {
    return (
      <Notice tone="warning" title="Slack sign-in is not configured on this deployment">
        <p>
          The operator needs to register a Slack app and set{" "}
          <span className="font-mono">SLACK_CLIENT_ID</span> and{" "}
          <span className="font-mono">SLACK_CLIENT_SECRET</span> before users can connect.
        </p>
      </Notice>
    );
  }

  return null;
}
