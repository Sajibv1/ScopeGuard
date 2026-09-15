"use server";

import { revalidatePath } from "next/cache";

import { fixtureWorkBreakdown } from "@/lib/ai/fixtures";
import { generate, isFixtureMode } from "@/lib/ai/provider";
import { WORK_BREAKDOWN_SYSTEM, workBreakdownUser } from "@/lib/ai/prompts";
import { WorkBreakdownSchema } from "@/lib/ai/schemas";
import { suggestHours } from "@/lib/ai/suggest-hours";
import { requireUser } from "@/lib/auth";
import { getProject } from "@/lib/data/projects";
import {
  addEstimateItem,
  deleteEstimateItem,
  getReviewableItems,
  listEstimateItems,
  listHourSuggestions,
  recordEvent,
  replaceHourSuggestions,
  updateEstimateItem,
} from "@/lib/data/requests";
import { messageFor, type FormState } from "@/lib/forms";
import { MoneyError, parseNonNegative, toDbNumeric } from "@/lib/money";
import { finalLabel } from "@/lib/documents/render";
import { setTax } from "@/lib/data/requests";

/**
 * Ask the model for work components.
 *
 * The schema has no field for hours or cost, so there is nowhere for the
 * model to put a number even if it tried. Every suggested line lands with
 * hours = NULL for the user to fill in (plan §8).
 */
export async function suggestWorkAction(
  projectId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    const [project, entries, existing] = await Promise.all([
      getProject(user.id, projectId),
      getReviewableItems(user.id, requestId),
      listEstimateItems(user.id, requestId),
    ]);

    // Only price what the user decided is additional work.
    const additional = entries.filter(
      (entry) => finalLabel(entry) === "potentially_additional",
    );

    if (additional.length === 0) {
      return {
        error:
          "No items are marked as potentially additional. Review the assessments first, or add estimate lines manually.",
      };
    }

    const alreadySuggested = new Set(existing.map((item) => item.description));

    const items = additional.map((entry) => ({
      title: entry.item.title,
      description: entry.item.description,
    }));

    const result = await generate({
      operation: "breakdown",
      system: WORK_BREAKDOWN_SYSTEM,
      user: workBreakdownUser(
        items.map((item) => `- ${item.title}: ${item.description}`).join("\n"),
      ),
      schema: WorkBreakdownSchema,
      schemaName: "work_breakdown",
      fixture: () => fixtureWorkBreakdown(items),
    });

    const titleToId = new Map(additional.map((entry) => [entry.item.title, entry.item.id]));

    for (const component of result.data.components) {
      if (alreadySuggested.has(component.description)) continue;

      await addEstimateItem(user.id, requestId, {
        description: component.description,
        requestItemId: titleToId.get(component.request_item_title) ?? null,
        // Hours stay blank. The model is never the source of a number.
        hours: null,
        rate: project.defaultRate,
        aiSuggested: true,
      });
    }

    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Draft reference hours for the lines the user has not filled in yet.
 *
 * Opt-in, and the drafts go to ai_hour_suggestions — a DISPLAY-ONLY table.
 * estimate_items.hours is never written here, computeTotals never reads the
 * drafts, and the user still types their own figure. This is the honest
 * version of the §8 "AI hours" item: a reference to react to, not a number
 * the money path can absorb.
 */
export async function suggestReferenceHoursAction(
  projectId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    // The project read is the ownership check — a foreign projectId 404s here.
    await getProject(user.id, projectId);
    const items = await listEstimateItems(user.id, requestId);

    // Only lines still missing hours. A line the user already priced is
    // theirs; re-drafting it would invite second-guessing a human figure.
    const unpriced = items.filter((item) => item.hours === null);

    if (unpriced.length === 0) {
      return { error: "Every line already has hours entered." };
    }

    const result = await suggestHours({
      lines: unpriced.map((item) => ({ estimateItemId: item.id, description: item.description })),
    });

    // Match drafts back to lines by exact description; an unmatched draft is
    // dropped rather than displayed against the wrong line.
    const byDescription = new Map(unpriced.map((item) => [item.description, item.id]));

    const matched = result.suggestions.flatMap((draft) => {
      const estimateItemId = byDescription.get(draft.estimateLine);
      if (!estimateItemId) return [];
      return [
        {
          estimateItemId,
          draftHours: toDbNumeric(BigInt(Math.round(draft.draftHours * 100)))!,
          rationale: draft.rationale,
        },
      ];
    });

    await replaceHourSuggestions(user.id, matched);

    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function addEstimateLineAction(
  projectId: string,
  requestId: string,
  input: { description: string; requestItemId: string | null },
): Promise<FormState> {
  const user = await requireUser();

  if (input.description.trim().length === 0) {
    return { error: "Describe the work before adding a line." };
  }

  try {
    const project = await getProject(user.id, projectId);

    await addEstimateItem(user.id, requestId, {
      description: input.description.trim(),
      requestItemId: input.requestItemId,
      hours: null,
      rate: project.defaultRate,
    });

    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Update one estimate line.
 *
 * Hours and rate are parsed with the decimal-safe parser, which rejects
 * negatives, thousands separators and excess precision rather than coercing
 * them into a plausible-looking wrong number.
 */
export async function updateEstimateLineAction(
  projectId: string,
  requestId: string,
  itemId: string,
  input: { description?: string; hours?: string; rate?: string },
): Promise<FormState> {
  const user = await requireUser();

  try {
    // The project read is the ownership check — members are read-only.
    await getProject(user.id, projectId);

    const patch: { description?: string; hours?: string | null; rate?: string | null } = {};

    if (input.description !== undefined) patch.description = input.description;
    if (input.hours !== undefined) {
      patch.hours = toDbNumeric(parseNonNegative(input.hours, "Hours"));
    }
    if (input.rate !== undefined) {
      patch.rate = toDbNumeric(parseNonNegative(input.rate, "Rate"));
    }

    await updateEstimateItem(user.id, itemId, patch);
    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    if (error instanceof MoneyError) return { error: error.message };
    return { error: messageFor(error) };
  }
}

export async function deleteEstimateLineAction(
  projectId: string,
  requestId: string,
  itemId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    await getProject(user.id, projectId);
    await deleteEstimateItem(user.id, itemId);
    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Set or clear the tax line.
 *
 * Label and rate are the user's input; the amount is never stored. Clearing
 * the rate clears the label too, so a label can never dangle without a rate.
 */
export async function setTaxAction(
  projectId: string,
  requestId: string,
  input: { label: string; rate: string },
): Promise<FormState> {
  const user = await requireUser();

  try {
    await getProject(user.id, projectId);

    const rate = input.rate.trim() === "" ? null : parseNonNegative(input.rate, "Tax rate");

    if (rate !== null && rate > 10000n) {
      return { error: "Tax rate is a percentage between 0 and 100." };
    }

    const label = rate === null ? null : input.label.trim() || "Tax";

    await setTax(user.id, requestId, { label, rate: toDbNumeric(rate) });

    revalidatePath(`/projects/${projectId}/requests/${requestId}/estimate`);
    return { ok: true };
  } catch (error) {
    if (error instanceof MoneyError) return { error: error.message };
    return { error: messageFor(error) };
  }
}

export async function recordEstimateEvent(
  projectId: string,
  requestId: string,
  note: string,
): Promise<void> {
  const user = await requireUser();
  // Owner-only: the estimate is the owner's record.
  await getProject(user.id, projectId);
  await recordEvent(user.id, {
    projectId,
    changeRequestId: requestId,
    event: "Estimate changed",
    note,
  });
}

export async function isFixtureModeAction(): Promise<boolean> {
  return isFixtureMode();
}
