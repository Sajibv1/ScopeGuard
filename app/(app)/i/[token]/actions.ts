"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { acceptInvite } from "@/lib/data/members";
import { messageFor } from "@/lib/forms";

/**
 * Accept an invite.
 *
 * The token is the capability — the RPC (security definer) validates it,
 * refuses already-used tokens, and is idempotent for the same user. On
 * success the browser lands on the project itself.
 */
export async function acceptInviteAction(token: string): Promise<void> {
  await requireUser(`/i/${token}`);

  let projectId: string;
  try {
    projectId = await acceptInvite(token);
  } catch (error) {
    // Signed errors (token used by someone else, revoked) land on the page
    // with the message rather than an error screen.
    redirect(`/i/${token}?error=${encodeURIComponent(messageFor(error))}`);
  }

  redirect(`/projects/${projectId}`);
}
