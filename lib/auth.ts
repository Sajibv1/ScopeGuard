/**
 * Session and authorization helpers.
 *
 * Every data function takes the user id explicitly rather than reaching for
 * an ambient session, so it is impossible to write a query that forgets whose
 * data it is reading. RLS enforces the same rule at the database; this layer
 * makes it visible in the code.
 */

import "server-only";

import { redirect } from "next/navigation";

import { NotFoundError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

/** The current user, or null. Never throws for a signed-out visitor. */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  // getUser() validates the JWT with the auth server. getSession() does not,
  // so it must never gate access.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
  };
}

/** The current user, or a redirect to sign-in. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getUser();
  if (user) return user;

  redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
}

// Re-exported so server modules can keep importing it from here.
export { NotFoundError };
