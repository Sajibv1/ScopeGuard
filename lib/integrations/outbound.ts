/**
 * CRM and payment scaffolds (§8). Slack lives in slack.ts — it is the one
 * wired for real.
 *
 * Each refuses honestly until its credentials exist (see registry.ts for the
 * rules). Neither of these will ever message a client or move money — the
 * constraints in the registry are part of each function's contract, not
 * decoration.
 */

import { INTEGRATIONS, notConfigured, type IntegrationResult } from "./registry.ts";

function specFor(id: "crm" | "payments") {
  return INTEGRATIONS.find((integration) => integration.id === id)!;
}

export interface CrmSync {
  /** The CRM's id for the synced record. */
  recordId: string;
}

/**
 * Push a project reference outward to the CRM.
 *
 * SCAFFOLD: refuses until CRM_PROVIDER/CRM_API_KEY exist. One direction
 * only — outbound references. A CRM can never write back into a scope,
 * estimate or approval.
 */
export async function syncToCrm(input: {
  projectName: string;
  reference: string;
}): Promise<IntegrationResult<CrmSync>> {
  return notConfigured(specFor("crm"));
}

export interface PaymentLink {
  url: string;
}

/**
 * Create a payment link for an APPROVED invoice.
 *
 * SCAFFOLD: refuses until the merchant credentials exist, and it is the last
 * of the four to wire up on purpose — money movement is not something to
 * enable as a side effect of configuration. When configured, the link can
 * only REFERENCE the invoice document; amounts stay human-entered and the
 * provider cannot change them through this product.
 */
export async function createPaymentLink(input: {
  invoiceReference: string;
}): Promise<IntegrationResult<PaymentLink>> {
  return notConfigured(specFor("payments"));
}
