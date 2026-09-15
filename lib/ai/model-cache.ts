/**
 * DB-backed ModelCache (see provider.ts for the interface and trust model).
 *
 * The sample seed injects this so the demo's two model calls — whose inputs
 * are public compile-time constants — run live once and serve every later
 * visitor from the verified result. Real user calls never pass a cache, so
 * no private document text can land in this table.
 *
 * Both operations are best-effort by construction: provider.generate() wraps
 * them so a cache outage only costs speed, never correctness.
 */

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ModelCache } from "./provider";

export function createModelCache(): ModelCache {
  return {
    async get(key) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("model_output_cache")
        .select("payload")
        .eq("cache_key", key)
        .maybeSingle();

      if (error) return null;
      return data?.payload ?? null;
    },

    async put(key, payload) {
      const supabase = await createClient();

      // Plain insert: rows are immutable (no update policy), so a duplicate
      // key — another visitor's concurrent seed writing the same verified
      // result — is expected and ignored along with any other failure.
      const { error } = await supabase
        .from("model_output_cache")
        .insert({ cache_key: key, payload });

      if (error) return;
    },
  };
}
