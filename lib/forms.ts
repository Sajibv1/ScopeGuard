/**
 * Shared form helpers.
 *
 * Kept out of the "use server" modules: those may only export async
 * functions, so constants and synchronous helpers live here.
 */

import { MoneyError } from "@/lib/money";
import { NotFoundError } from "@/lib/errors";

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "NZD",
  "SEK",
  "CHF",
  "JPY",
  "INR",
] as const;

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

/**
 * Turn an exception into something worth showing a user.
 *
 * Never surfaces raw database errors: they leak schema details and read as
 * noise. The fallback deliberately says the user's work was kept, because
 * that is the actual guarantee (plan §11: "Failed AI calls do not erase work").
 */
export function messageFor(error: unknown): string {
  if (error instanceof MoneyError) return error.message;
  if (error instanceof NotFoundError) return error.message;

  if (error instanceof Error) {
    // Postgres error codes surfaced through PostgREST.
    const code = (error as { code?: string }).code;

    if (code === "23505") return "That record already exists.";
    if (code === "23514" || code === "P0001") {
      // Our immutability triggers raise check_violation with a readable message.
      return error.message.replace(/^.*?:\s*/, "");
    }
    if (code === "42501") {
      return "You do not have access to that record.";
    }
    if (code?.startsWith("PGRST")) {
      return "That record could not be found.";
    }

    return error.message;
  }

  return "Something went wrong. Your work has been saved — please try again.";
}
