/**
 * Deterministic rendering of the scope recap (plan §10, Tier 2).
 *
 * The recap is what the user sends a client after a call that produced no
 * recording and no document: "here is what I understood — reply to confirm or
 * correct." Every sentence is generated here from stored records, not by a
 * model, because the recap's whole job is honesty about its own status: it
 * states its author, the call it recaps, and that it awaits confirmation.
 * Nothing in it is an agreement until the client's reply says so.
 */

import { formatDate } from "./render";
import { SCOPE_CATEGORY_LABELS, type Project, type ScopeDocument, type ScopeItem } from "../types";

export interface RenderedRecap {
  projectName: string;
  clientName: string | null;
  /** When the recap PDF was generated. */
  preparedOn: string;
  /** When the call being recapped took place, if the user noted it. */
  callDate: string | null;
  /** Who was on that call, if the user noted it. */
  participants: string | null;
  intro: string;
  items: Array<{ categoryLabel: string; description: string }>;
  closing: string;
}

export function renderScopeRecap(input: {
  project: Project;
  document: ScopeDocument;
  items: ScopeItem[];
  preparedOn: string;
}): RenderedRecap {
  const { project, document, items } = input;

  const when = document.callDate
    ? ` our call on ${formatDate(document.callDate)}`
    : " our recent call";
  const who = document.participants ? ` with ${document.participants}` : "";

  const intro =
    `Here is what I understood from${when}${who}. ` +
    "This is my recollection of what we discussed — not an agreement. " +
    "Please reply to confirm it matches your understanding, or correct anything that does not.";

  const closing =
    "Until you reply, nothing above is agreed scope. A short reply is enough — " +
    "and if any line is wrong, say so and I will correct it before we proceed.";

  return {
    projectName: project.name,
    clientName: project.clientName,
    preparedOn: input.preparedOn,
    callDate: document.callDate,
    participants: document.participants,
    intro,
    items: items.map((item) => ({
      categoryLabel: SCOPE_CATEGORY_LABELS[item.category],
      description: item.description,
    })),
    closing,
  };
}
