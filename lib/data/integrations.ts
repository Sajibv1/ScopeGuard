/**
 * Per-user integration credentials (migration 0007).
 *
 * Same rules as every other data module: the user id is an explicit
 * parameter, and RLS enforces owner-only access at the database. Tokens are
 * encrypted before they are written (lib/integrations/secret-box) and
 * decrypted only in memory on the way out — the plaintext token never
 * appears in a query, a log, or a returned row.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/integrations/secret-box";

export interface SlackCredential {
  token: string;
  /** Where notifications post — "#name" or a channel id. Null until chosen. */
  channel: string | null;
  teamName: string | null;
  connectedAt: string;
}

interface CredentialRow {
  access_token_enc: string;
  metadata: { channel?: string; team_name?: string };
  created_at: string;
}

async function fetchRow(userId: string, provider: string): Promise<CredentialRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("integration_credentials")
    .select("access_token_enc, metadata, created_at")
    .eq("owner_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getSlackCredential(userId: string): Promise<SlackCredential | null> {
  const row = await fetchRow(userId, "slack");
  if (!row) return null;

  return {
    token: decryptSecret(row.access_token_enc),
    channel: row.metadata.channel ?? null,
    teamName: row.metadata.team_name ?? null,
    connectedAt: row.created_at,
  };
}

/** Insert or replace the user's Slack connection (one row per user+provider). */
export async function saveSlackCredential(
  userId: string,
  input: {
    token: string;
    teamName: string | null;
    botUserId: string | null;
    slackUserId: string | null;
  },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("integration_credentials").upsert(
    {
      owner_id: userId,
      provider: "slack",
      access_token_enc: encryptSecret(input.token),
      metadata: {
        team_name: input.teamName,
        bot_user_id: input.botUserId,
        slack_user_id: input.slackUserId,
      },
    },
    { onConflict: "owner_id,provider" },
  );

  if (error) throw error;
}

export async function setSlackChannel(userId: string, channel: string): Promise<void> {
  const supabase = await createClient();
  const row = await fetchRow(userId, "slack");
  if (!row) throw new Error("Connect Slack before choosing a channel.");

  const { error } = await supabase
    .from("integration_credentials")
    .update({ metadata: { ...row.metadata, channel } })
    .eq("owner_id", userId)
    .eq("provider", "slack");

  if (error) throw error;
}

export async function disconnectSlack(userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("integration_credentials")
    .delete()
    .eq("owner_id", userId)
    .eq("provider", "slack");

  if (error) throw error;
}
