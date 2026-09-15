/**
 * Server-side Supabase client for React Server Components, route handlers and
 * server actions.
 *
 * Always uses the ANON key with the user's session attached, never the service
 * role key. That is deliberate: it means every query in the app runs through
 * row-level security, so a missing `.eq("owner_id", ...)` filter cannot leak
 * another account's data. Authorization is enforced by the database, and the
 * query layer's own owner checks are a second line rather than the only one.
 */

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session CREATION must never happen in that context — see
            // app/demo/start/route.ts, which performs sign-ins in a Route
            // Handler precisely so this write path runs.
          }
        },
      },
    },
  );
}

/**
 * Service-role access is deliberately NOT provided.
 *
 * Every code path in this app acts on behalf of a signed-in user — including
 * the public demo, which uses Supabase anonymous auth so each visitor is a
 * real user whose data RLS isolates automatically (plan §1: "One visitor's
 * demo edits never appear in another visitor's session"). Because the sample
 * project is seeded by the visitor's own session, nothing needs to bypass RLS,
 * so there is no client here that can. That also means the app runs without a
 * SUPABASE_SERVICE_ROLE_KEY at all.
 */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in your Supabase project details.`,
    );
  }
  return value;
}
