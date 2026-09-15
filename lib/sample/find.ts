/**
 * Locating an existing sample project (plan Feature 1).
 *
 * The demo must be idempotent for a returning visitor: once their sample is
 * seeded, every later "demo" entry point (navbar, hero, /demo, /demo/start)
 * leads back to THAT project instead of re-seeding one — otherwise the
 * pipeline runs again and any edits the visitor made while exploring are
 * deleted out from under them. seed.ts is deliberately heavy (it wires the
 * whole AI pipeline); this module stays light so the landing page can import
 * it without dragging all of that along.
 *
 * The demo's landing surface is the dashboard: it opens showing the sample
 * project like any other, and the visitor walks into the review from there —
 * the same navigation a real user takes.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Where an existing (or just-seeded) sample sends the visitor. */
export const SAMPLE_DESTINATION = "/dashboard";

/** True when the user already owns a seeded sample project. */
export async function hasSample(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .eq("is_sample", true);

  return (count ?? 0) > 0;
}
