"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { disconnectSlack, setSlackChannel } from "@/lib/data/integrations";
import { messageFor, type FormState } from "@/lib/forms";

/**
 * Choose (or change) the channel your own Slack connection posts to.
 * The connection itself is the OAuth flow at /integrations/slack/connect.
 */
export async function setSlackChannelAction(channel: string): Promise<FormState> {
  const user = await requireUser("/integrations");

  const trimmed = channel.trim();
  // A channel name like #change-orders, or a raw channel id like C0C1ADGFQCR.
  if (!/^#[a-z0-9._-]+$|^[A-Z0-9]+$/.test(trimmed)) {
    return { error: "Pick a channel from the list, or enter one like #change-orders." };
  }

  try {
    await setSlackChannel(user.id, trimmed);
    revalidatePath("/integrations");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Remove the signed-in user's Slack connection and delete its stored token. */
export async function disconnectSlackAction(): Promise<FormState> {
  const user = await requireUser("/integrations");

  try {
    await disconnectSlack(user.id);
    revalidatePath("/integrations");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}
