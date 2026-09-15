/**
 * Fixture mode: deterministic stand-ins used when no OPENAI_API_KEY is set.
 *
 * These are not canned strings. They are a small rule-based engine that reads
 * the actual scope text and the actual client message, so the offline demo
 * produces REAL citations — which then go through the same verification path
 * as model output in lib/ai/citations.ts. A fixture that cited a quote the
 * document does not contain would be rejected exactly like a hallucination.
 *
 * The engine is deliberately conservative. It never labels something
 * "potentially additional" on the strength of absence, because that is the
 * one judgement the plan (§6) singles out as unacceptable. When it cannot
 * find affirmative evidence either way, it says "needs clarification" — which
 * is also the honest answer for a keyword matcher.
 *
 * The UI always shows a "fixture mode" banner when these are in play.
 */

import type { ScopeItem } from "../types.ts";

import type {
  DocumentDraft,
  HourSuggestions,
  LegalFlags,
  NotesScopeExtraction,
  RequestAnalysis,
  ScopeExtraction,
  TranscriptScopeExtraction,
  WorkBreakdown,
} from "./schemas.ts";

const STOP_WORDS = new Set([
  "a", "add", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been",
  "but", "by", "can", "could", "do", "does", "for", "from", "get", "has", "have",
  "in", "is", "it", "its", "just", "like", "make", "me", "my", "need", "of", "on",
  "one", "or", "our", "please", "put", "so", "some", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "to", "up", "us", "want",
  "was", "we", "were", "will", "with", "would", "you", "your",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .map(stem),
  );
}

/**
 * Crude suffix stemmer — enough to match "pages"/"page", "payment"/"pay".
 *
 * Standard suffix classes only. Resist adding rules that exist to make one
 * eval case pass: a stemmer tuned to the test set measures nothing.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ment")) return word.slice(0, -4);
  if (word.length > 5 && word.endsWith("tion")) return `${word.slice(0, -4)}t`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Score at which a scope item is considered squarely on-topic. */
const STRONG_MATCH = 2;

/** Score at which an item is related enough to be worth surfacing as conflict. */
const WEAK_MATCH = 1;

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) if (b.has(word)) count++;
  return count;
}

// ── Operation A ─────────────────────────────────────────────────────────────

/**
 * Extract scope items by sentence classification. Each item quotes the whole
 * sentence it came from, which is always verbatim by construction.
 */
export function fixtureScopeExtraction(
  documentText: string,
  locatorLabel: (offset: number) => string,
): ScopeExtraction {
  const items: ScopeExtraction["items"] = [];

  for (const { text, start } of splitSentences(documentText)) {
    const lower = text.toLowerCase();
    const category = classifySentence(lower);
    if (!category) continue;

    items.push({
      category,
      description: summarize(text),
      quote: text,
      locator: locatorLabel(start),
    });
  }

  return { items };
}

function classifySentence(lower: string): ScopeExtraction["items"][number]["category"] | null {
  if (/\b(exclud|not included|does not include|out of scope|no\s+\w+\s+will be)\b/.test(lower)) {
    return "exclusion";
  }
  if (/\b(revision|round)s?\b/.test(lower)) return "revision_limit";
  if (/\b(up to|maximum|no more than|at most|limited to)\b/.test(lower)) {
    return "quantity_limit";
  }
  if (/\b(client (will|is responsible|provides|supplies)|provided by the client)\b/.test(lower)) {
    return "client_responsibility";
  }
  if (/\b(approval|sign-off|milestone|before (implementation|development)|phase)\b/.test(lower)) {
    return "milestone";
  }
  if (/\b(english|language|browser|only|must be|compatible)\b/.test(lower)) {
    return "constraint";
  }
  if (/\b(includes?|will (build|develop|implement|deliver|integrate)|integration|form)\b/.test(lower)) {
    return "included_functionality";
  }
  if (/\b(deliver|website|site|page|design|build)\b/.test(lower)) return "deliverable";
  return null;
}

function summarize(sentence: string): string {
  const clean = sentence.replace(/\s+/g, " ").trim();
  return clean.length <= 160 ? clean : `${clean.slice(0, 157)}...`;
}

// ── Operation A, transcript variant (plan §10 Tier 1) ───────────────────────

/**
 * Keyword stand-in for the commitment judgement. It mirrors the live prompt's
 * order of checks: an explicit yes-word wins, then hedges are "suggested",
 * and everything else is "discussed" — the honest default when a matcher
 * cannot tell enthusiasm from commitment.
 */
function classifyCommitment(lower: string): TranscriptScopeExtraction["items"][number]["commitment"] {
  if (/\b(we'?ll|we will|yes|yeah|yep|definitely|agreed|sounds good|that works|let'?s do|go ahead|it'?s in|that'?s in|confirmed)\b/.test(lower)) {
    return "agreed";
  }
  if (/\b(maybe|might|could|would be nice|what if|i'?d like|idea|consider|perhaps|option|possibly|someday|later)\b/.test(lower)) {
    return "suggested";
  }
  return "discussed";
}

export function fixtureTranscriptExtraction(
  documentText: string,
  locatorLabel: (offset: number) => string,
): TranscriptScopeExtraction {
  const items: TranscriptScopeExtraction["items"] = [];

  for (const { text, start } of splitSentences(documentText)) {
    const lower = text.toLowerCase();
    const category = classifySentence(lower);
    if (!category) continue;

    items.push({
      category,
      description: summarize(text),
      quote: text,
      locator: locatorLabel(start),
      commitment: classifyCommitment(lower),
    });
  }

  return { items };
}

// ── Operation A, no-source variant (plan §10 Tier 2) ────────────────────────

/**
 * Keyword stand-in for notes structuring. Same sentence classifier as the
 * document path, but NOTHING is quoted: these are the user's own recollections
 * and the output shape has no quote fields to fill. Every item the live model
 * proposes on this path is equally quoteless — memory is not evidence.
 */
export function fixtureNotesExtraction(notesText: string): NotesScopeExtraction {
  const items: NotesScopeExtraction["items"] = [];

  for (const { text } of splitSentences(notesText)) {
    const lower = text.toLowerCase();
    const category = classifySentence(lower);
    if (!category) continue;

    items.push({
      category,
      description: summarize(text),
    });
  }

  return { items };
}

// ── Operation B ─────────────────────────────────────────────────────────────

export function fixtureRequestAnalysis(
  clientMessage: string,
  scopeItems: ScopeItem[],
  userContext: string | null,
): RequestAnalysis {
  const contextWords = userContext ? keywords(userContext) : new Set<string>();

  const items = splitRequests(clientMessage).map((request) => {
    const words = keywords(request.text);

    const allScored = scopeItems
      .filter((item) => item.sourceQuote)
      .map((item) => ({
        item,
        score: overlap(words, keywords(`${item.description} ${item.sourceQuote ?? ""}`)),
      }))
      .sort((a, b) => b.score - a.score);

    const scored = allScored.filter((entry) => entry.score >= STRONG_MATCH);
    // Related-but-weaker matches are not strong enough to decide a label, but
    // they are exactly what the plan means by conflicting evidence.
    const related = allScored.filter((entry) => entry.score >= WEAK_MATCH);

    const best = scored[0];
    const exclusion = scored.find((entry) => entry.item.category === "exclusion");

    /*
     * A revision-capped project needs special handling regardless of keyword
     * overlap, because the plan's headline edge case (§6) turns on it: a
     * request to change something is a revision, and a revision cap whose
     * consumption we cannot see proves nothing either way. Generic scoring
     * missed this — "replace the hero image" shares almost no vocabulary with
     * "two rounds of revisions" — so any change-shaped request is checked
     * against a revision limit directly.
     */
    const revisionLimit =
      scopeItems.find((item) => item.category === "revision_limit" && item.sourceQuote) ?? null;
    const isChangeRequest =
      /\b(revis|chang|replac|updat|swap|tweak|adjust|amend|re-?do|different)\w*\b/i.test(
        request.text,
      );

    const limit = scored.find(
      (entry) =>
        entry.item.category === "quantity_limit" || entry.item.category === "revision_limit",
    );

    const title = toTitle(request.text);
    const base = {
      title,
      description: summarize(request.text),
      source_excerpt: request.text,
    };

    // An explicit exclusion is affirmative evidence of "potentially additional".
    if (exclusion) {
      return {
        ...base,
        label: "potentially_additional" as const,
        explanation: `The agreement explicitly excludes this, so it appears to fall outside the current scope.`,
        supporting_evidence: [cite(exclusion.item)],
        conflicting_evidence: [],
        missing_information: [],
        suggested_question: `Would you like me to quote this as additional work?`,
      };
    }

    // A limit whose consumption we cannot see is NOT proof of overage.
    const applicableRevisionLimit =
      limit?.item.category === "revision_limit"
        ? limit.item
        : isChangeRequest
          ? revisionLimit
          : null;

    if (applicableRevisionLimit) {
      const contextKnown = overlap(contextWords, new Set(["revision", "round", "used"])) >= 2;
      if (!contextKnown) {
        return {
          ...base,
          label: "needs_clarification" as const,
          explanation: `The agreement caps revision rounds, but the number already used is not recorded, so whether this request falls inside the allowance cannot be determined from the document.`,
          supporting_evidence: [],
          conflicting_evidence: [cite(applicableRevisionLimit)],
          missing_information: ["Number of revision rounds already completed"],
          suggested_question: "How many revision rounds have already been completed?",
        };
      }
    }

    if (limit && limit.item.category === "quantity_limit") {
      return {
        ...base,
        label: "potentially_additional" as const,
        explanation: `The agreement states a limit that this request appears to exceed.`,
        supporting_evidence: [cite(limit.item)],
        conflicting_evidence: [],
        missing_information: [],
        suggested_question: "Should the additional items be quoted separately?",
      };
    }

    if (best && best.item.category === "included_functionality") {
      /*
       * Before affirming coverage, check whether any exclusion or limit
       * clause also touches this request. A document that both promises a
       * blog CMS and excludes admin interfaces is contradictory, and the plan
       * requires the conflict to be SURFACED rather than resolved silently in
       * the client's favour.
       *
       * The contradicting clause must be at least half as on-topic as the
       * supporting one. A flat "shares one word" test produced false
       * conflicts: the five-page limit clause lists "Contact" as a page name,
       * which made every contact-form request look contradicted. A clause
       * that merely mentions a word in passing is not a contradiction; one
       * that is comparably about the same subject is.
       */
      const conflictThreshold = Math.max(WEAK_MATCH, Math.ceil(best.score / 2));

      const contradicting = related.find(
        (entry) =>
          entry.item.id !== best.item.id &&
          entry.score >= conflictThreshold &&
          (entry.item.category === "exclusion" ||
            entry.item.category === "quantity_limit" ||
            entry.item.category === "constraint"),
      );

      if (contradicting) {
        return {
          ...base,
          label: "needs_clarification" as const,
          explanation: `The agreement appears to both cover and restrict this. One clause supports it while another points the other way, so it cannot be settled from the document alone.`,
          supporting_evidence: [],
          conflicting_evidence: [cite(best.item), cite(contradicting.item)],
          missing_information: ["Which clause governs where the two conflict"],
          suggested_question:
            "The agreement seems to contradict itself on this point — can we confirm which was intended?",
        };
      }

      return {
        ...base,
        label: "included" as const,
        explanation: `The agreement affirmatively covers this work.`,
        supporting_evidence: [cite(best.item)],
        conflicting_evidence: [],
        missing_information: [],
        suggested_question: null,
      };
    }

    // No affirmative evidence either way. Absence is not exclusion.
    return {
      ...base,
      label: "needs_clarification" as const,
      explanation: `The agreement does not address this request, so it cannot be classified from the document alone. Absence from the agreement is not by itself evidence that the work is out of scope.`,
      supporting_evidence: [],
      conflicting_evidence: best ? [cite(best.item)] : [],
      missing_information: ["Whether this was agreed outside the written scope"],
      suggested_question: `Was this discussed before the agreement was signed?`,
    };
  });

  return { items };
}

function cite(item: ScopeItem) {
  return { quote: item.sourceQuote ?? "", locator: item.sourceLocator ?? "" };
}

// ── Work breakdown ──────────────────────────────────────────────────────────

const WORK_TEMPLATES: Array<{ match: RegExp; components: string[] }> = [
  {
    match: /\b(login|auth|oauth|sign[- ]?in|sso)\b/i,
    components: [
      "Configure the identity provider and credentials",
      "Build the sign-in interface",
      "Implement the callback and account-linking flow",
      "Handle error and edge-case states",
      "Test across new and existing accounts",
    ],
  },
  {
    match: /\b(dashboard|admin|analytics|report)\b/i,
    components: [
      "Define the data the dashboard needs to show",
      "Build the dashboard layout and views",
      "Implement access control for administrators",
      "Test with representative data",
    ],
  },
  {
    match: /\b(translat|french|spanish|german|language|multiling|localis|localiz|i18n)\b/i,
    components: [
      "Introduce the internationalisation framework",
      "Extract existing copy into translation files",
      "Add the language switcher",
      "Integrate supplied translations and review layout",
    ],
  },
  {
    match: /\b(image|photo|hero|banner|asset|graphic)\b/i,
    components: [
      "Source or receive the replacement asset",
      "Optimise and export the required sizes",
      "Update the component and verify responsive behaviour",
    ],
  },
  {
    match: /\b(page|section|landing)\b/i,
    components: [
      "Design the new page layout",
      "Build the page and wire up navigation",
      "Add content and review responsive behaviour",
    ],
  },
];

export function fixtureWorkBreakdown(
  items: Array<{ title: string; description: string }>,
): WorkBreakdown {
  const components: WorkBreakdown["components"] = [];

  for (const item of items) {
    const haystack = `${item.title} ${item.description}`;
    const template = WORK_TEMPLATES.find((entry) => entry.match.test(haystack));
    const list = template?.components ?? [
      "Clarify the detailed requirement",
      "Implement the change",
      "Test and review with the client",
    ];

    for (const description of list) {
      components.push({ request_item_title: item.title, description });
    }
  }

  return { components };
}

// ── Reference hour drafts ────────────────────────────────────────────────────

/**
 * Keyword-anchored reference hours. Rough by design — a fixture that produced
 * precise-looking numbers would be the exact failure mode the honest version
 * of this feature exists to avoid.
 */
const HOUR_ANCHORS: Array<{ match: RegExp; hours: number; driver: string }> = [
  {
    match: /\b(oauth|callback|identity provider|account[- ]link|sso|auth)\b/i,
    hours: 6,
    driver: "provider configuration, callback handling and account linking are each typically about a day",
  },
  {
    match: /\b(dashboard|admin|analytics|report)\b/i,
    hours: 8,
    driver: "a small dashboard is usually a day of views plus a day of access control",
  },
  {
    match: /\b(translat|i18n|localis|localiz|multiling)\b/i,
    hours: 10,
    driver: "framework setup plus copy extraction across existing pages typically runs over two days",
  },
  {
    match: /\b(image|photo|hero|banner|asset|graphic)\b/i,
    hours: 2,
    driver: "a single asset swap is usually short once the files are final",
  },
  {
    match: /\b(page|section|landing)\b/i,
    hours: 5,
    driver: "one new page is typically layout, build and responsive review",
  },
];

export function fixtureHourSuggestions(
  lines: Array<{ description: string }>,
): HourSuggestions {
  return {
    suggestions: lines.map((line) => {
      const anchor = HOUR_ANCHORS.find((entry) => entry.match.test(line.description));
      return {
        estimate_line: line.description,
        draft_hours: anchor?.hours ?? 4,
        rationale: anchor
          ? anchor.driver
          : "typical small changes on a content site run about half a day, absent specifics",
      };
    }),
  };
}

// ── Legal topic flags ────────────────────────────────────────────────────────

/**
 * Topic pointer, same as the live prompt: names a subject and why it was
 * raised, and contains no conclusion. The wording here must survive the same
 * findLegalClaims check as model output.
 */
const LEGAL_TOPICS: Array<{ match: RegExp; topic: string; note: string }> = [
  {
    match: /\b(indemnif|hold harmless)\b/i,
    topic: "Indemnification",
    note: "This change touches an area where the agreement may contain indemnification wording. A professional can check how the new work interacts with it.",
  },
  {
    match: /\b(liability|insurance)\b/i,
    topic: "Liability",
    note: "Liability language in the agreement may be relevant to this change. Worth having a professional review the applicable clauses.",
  },
  {
    match: /\b(intellectual property|\bip\b|copyright|licens|ownership)\b/i,
    topic: "IP ownership",
    note: "The request involves ownership or licensing of delivered work, which agreements often address specifically. A professional can confirm which terms apply.",
  },
  {
    match: /\b(warrant|guarant)\b/i,
    topic: "Warranty",
    note: "If the agreement includes warranty terms, this change may sit inside or outside them. A professional can determine which.",
  },
  {
    match: /\b(gdpr|data protection|privacy|personal data)\b/i,
    topic: "Data protection",
    note: "This change involves personal data, which data-protection rules may govern. A professional can advise on the applicable obligations.",
  },
  {
    match: /\b(terminat|penalt|cancel)\b/i,
    topic: "Termination",
    note: "The request may interact with termination or cancellation terms in the agreement. Worth confirming with a professional.",
  },
];

export function fixtureLegalFlags(
  items: Array<{ title: string; description: string }>,
): LegalFlags {
  const flags: LegalFlags["flags"] = [];

  for (const item of items) {
    const haystack = `${item.title} ${item.description}`;
    for (const topic of LEGAL_TOPICS) {
      if (topic.match.test(haystack)) {
        flags.push({
          request_item_title: item.title,
          topic: topic.topic,
          note: topic.note,
        });
      }
    }
  }

  return { flags };
}

// ── Operation C ─────────────────────────────────────────────────────────────

export interface FixtureDraftInput {
  clientName: string | null;
  tone: "friendly" | "formal";
  included: string[];
  additional: string[];
  clarification: string[];
  hasEstimate: boolean;
}

export function fixtureDocumentDraft(input: FixtureDraftInput): DocumentDraft {
  const friendly = input.tone === "friendly";
  const list = (entries: string[]) => entries.map((entry) => lowerFirst(entry)).join(", ");

  return {
    reply_acknowledgement: friendly
      ? `Thanks for sending this over — I've gone through your request against what we agreed.`
      : `Thank you for your message. I have reviewed your request against the agreed scope of work.`,

    reply_covered: input.included.length
      ? friendly
        ? `Good news: ${list(input.included)} ${input.included.length === 1 ? "is" : "are"} already covered by our agreement, so I can pick that up as part of the current work.`
        : `The following falls within the agreed scope and will proceed as part of the current engagement: ${list(input.included)}.`
      : "",

    reply_additional: input.additional.length
      ? friendly
        ? `A couple of things look like they'd extend what we originally agreed: ${list(input.additional)}. I've put together what that would involve.`
        : `The following appears to extend the agreed scope: ${list(input.additional)}. The additional work required is set out below.`
      : "",

    reply_questions: input.clarification.length
      ? friendly
        ? `Before I can give you a firm answer on ${list(input.clarification)}, could you help me with a couple of details?`
        : `Clarification is required before the following can be assessed: ${list(input.clarification)}.`
      : "",

    reply_next_step: input.hasEstimate
      ? friendly
        ? `Have a look at the breakdown below and let me know if you'd like me to proceed.`
        : `Please review the breakdown below and confirm whether you wish to proceed.`
      : friendly
        ? `Let me know how you'd like to handle this and I'll follow up.`
        : `Please advise how you wish to proceed and I will follow up accordingly.`,

    change_order_summary: `This change order covers the client's request${
      input.additional.length ? ` for ${list(input.additional)}` : ""
    }, assessed against the confirmed scope baseline for this project.`,

    change_order_assumptions: input.hasEstimate
      ? `The estimate assumes the requirements described above are complete and that any content, credentials, or third-party access needed is supplied by the client.`
      : "",

    change_order_exclusions: input.clarification.length
      ? `Items still under clarification are not covered by this change order and are not included in the estimate.`
      : "",
  };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ── Text splitting ──────────────────────────────────────────────────────────

interface Span {
  text: string;
  start: number;
}

/** Split into sentences, keeping original offsets for locator lookup. */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const trimmedStart = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value.length < 15) continue;
    spans.push({ text: value, start: match.index + trimmedStart });
  }

  return spans;
}

/**
 * Split a client message into atomic requests. Handles the plan's worked
 * example: "Please add Google login and an admin dashboard. Also change the
 * hero image and make the site available in French." -> four items.
 */
export function splitRequests(message: string): Span[] {
  const spans: Span[] = [];

  for (const sentence of splitSentences(message)) {
    // Split on conjunctions that join two distinct asks, but not on "and" that
    // sits inside a noun phrase like "terms and conditions".
    const parts = sentence.text.split(/,\s+(?:and\s+)?(?=\w)|\s+and\s+(?=(?:an?|the)\s|\w+\s+(?:the|a|an)\s)/i);

    let cursor = sentence.start;
    for (const part of parts) {
      const value = part.trim().replace(/^(?:also|then|plus)\s+/i, "");
      const offset = message.indexOf(part.trim(), cursor);
      if (value.length >= 10) {
        spans.push({
          text: message.slice(
            offset === -1 ? cursor : offset,
            (offset === -1 ? cursor : offset) + part.trim().length,
          ),
          start: offset === -1 ? cursor : offset,
        });
      }
      cursor = (offset === -1 ? cursor : offset) + part.length;
    }
  }

  return spans.length ? spans : splitSentences(message);
}

function toTitle(text: string): string {
  const clean = text
    .replace(/^(?:please|could you|can you|would you|i'd like|i would like|we need|we'd like)\s+/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  const capped = clean.charAt(0).toUpperCase() + clean.slice(1);
  return capped.length <= 70 ? capped : `${capped.slice(0, 67)}...`;
}
