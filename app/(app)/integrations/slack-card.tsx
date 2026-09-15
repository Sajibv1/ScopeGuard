"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { disconnectSlackAction, setSlackChannelAction } from "./actions";
import { IntegrationIcon } from "./integration-icon";
import { Button, Card, Notice } from "@/components/ui";
import type { SlackChannel } from "@/lib/integrations/slack";

/**
 * The signed-in user's own Slack connection (per-user OAuth, migration 0007):
 * shows which workspace is connected and which channel notifications post
 * to. Disconnect deletes the stored token — it is the user's connection to
 * remove, and removal is immediate and complete.
 */
export function SlackConnectionCard({
  teamName,
  channel,
  channels,
  channelListFailed,
  connectedAt,
}: {
  teamName: string | null;
  channel: string | null;
  channels: SlackChannel[];
  channelListFailed: string | null;
  connectedAt: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(
    channel ?? (channels[0] ? `#${channels[0].name}` : ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Which action is in flight, so the buttons label themselves honestly
  // instead of "Saving…" appearing when Disconnect was clicked.
  const [pendingAction, setPendingAction] = useState<"save" | "disconnect" | null>(null);
  // Disconnect deletes the stored token; the second click is the consent.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    setPendingAction("save");
    startTransition(async () => {
      const result = await setSlackChannelAction(selected);
      setPendingAction(null);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      }
    });
  }

  function disconnect() {
    setPendingAction("disconnect");
    startTransition(async () => {
      const result = await disconnectSlackAction();
      setPendingAction(null);
      setConfirmDisconnect(false);
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <IntegrationIcon id="slack" />
          <h2 className="text-sm font-semibold text-foreground">Slack</h2>
        </div>
        <span className="rounded border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-xs text-ok">
          connected
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Your Slack workspace{teamName ? <> — <strong>{teamName}</strong></> : null} is connected.
        When you finalize a change order, ScopeGuard posts it to the channel you choose below,
        using <strong>your</strong> connection. Connected {formatDay(connectedAt)}.
      </p>

      {channel ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Notifying </span>
          <span className="font-mono text-foreground">{channel}</span>
        </p>
      ) : (
        <Notice tone="warning" className="mt-3" title="Pick a channel to finish setup">
          <p>The connection is authorized but has no channel yet, so nothing is posted.</p>
        </Notice>
      )}

      {channelListFailed ? (
        <Notice tone="warning" className="mt-3" title="The channel list did not load">
          <p>
            {channelListFailed} You can still type a public channel name below, e.g.
            <span className="font-mono"> #change-orders</span>. With the{" "}
            <span className="font-mono">chat:write.public</span> scope the bot can post to public
            channels without an invite.
          </p>
        </Notice>
      ) : null}

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-foreground">
            Post finalized change orders to
          </span>
          {channels.length > 0 ? (
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              {channels.map((entry) => (
                <option key={entry.id} value={`#${entry.name}`}>
                  #{entry.name}
                  {entry.isMember ? "" : " (no invite needed)"}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              placeholder="#change-orders"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            />
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={save}
            disabled={pending || selected.trim() === ""}
          >
            {pendingAction === "save" ? "Saving…" : "Save channel"}
          </Button>
          {saved ? (
            <p role="status" className="text-sm text-ok">
              Channel saved
            </p>
          ) : null}
          {confirmDisconnect ? (
            <>
              <Button
                variant="danger"
                onClick={disconnect}
                disabled={pending}
              >
                {pendingAction === "disconnect" ? "Disconnecting…" : "Confirm disconnect"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmDisconnect(false)}
                disabled={pending}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="danger"
              onClick={() => setConfirmDisconnect(true)}
              disabled={pending}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The client is never a recipient: notifications go to your team&rsquo;s channels only, and
        the notification can never change a figure or a status. Disconnecting deletes the stored
        token immediately.
      </p>

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}
