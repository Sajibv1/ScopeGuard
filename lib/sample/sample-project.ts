/**
 * The sample project (plan Feature 1).
 *
 * Entirely fictional. It exists so a judge can reach the assessment review
 * screen in two clicks without pasting a real client agreement, and so the
 * demo exercises the ACTUAL workflow rather than screenshots.
 *
 * The statement of work below is written to contain one clean instance of
 * each case the product claims to handle:
 *
 *   - an explicit inclusion    -> contact form
 *   - an explicit exclusion    -> user accounts
 *   - a quantity limit         -> five pages
 *   - a revision limit whose consumption is unknowable from the document
 *   - a hard constraint        -> English only
 *   - a client responsibility  -> copy and images
 *
 * The client message then hits four of them at once, which is what makes the
 * decomposition step visible rather than theoretical.
 */

export const SAMPLE_PROJECT = {
  name: "Northwind Bakery Website",
  clientName: "Northwind Bakery",
  description: "Marketing site for a three-location bakery. Sample data.",
  currency: "USD",
  defaultRate: "85.00",
} as const;

export const SAMPLE_SCOPE_TITLE = "Statement of Work — Northwind Bakery Website (v1)";

export const SAMPLE_SCOPE_TEXT = `Statement of Work — Northwind Bakery Website

1. Overview

Meridian Web Studio ("the Developer") will design and build a marketing website for Northwind Bakery ("the Client"). This document defines the agreed scope of work.

2. Deliverables

The Developer will deliver a responsive marketing website consisting of up to five pages: Home, About, Menu, Locations, and Contact. The website will be delivered in English only.

A contact form with email notification to the Client's inbox is included in the build.

Basic on-page search engine optimisation, including page titles and meta descriptions, is included.

3. Exclusions

User accounts, customer logins, and any form of authentication are explicitly excluded from this engagement.

Online ordering, payment processing, and delivery scheduling are not included in this project and would require a separate agreement.

Ongoing content updates after launch are excluded. The Client may purchase a maintenance retainer separately.

4. Revisions

Two rounds of design revisions are included in the project fee. Additional revision rounds will be quoted separately at the Developer's standard hourly rate.

5. Client responsibilities

The Client will provide all written copy and photography in final form before development begins. The Developer is not responsible for delays arising from late delivery of content.

The Client will provide access to their domain registrar and hosting account.

6. Milestones

Design mockups require written Client approval before implementation begins.`;

export const SAMPLE_REQUEST_TITLE = "Menu updates and online ordering";

export const SAMPLE_CLIENT_MESSAGE = `Hi,

Thanks for sending the mockups over — they look great overall.

A few things we'd like to sort out before launch. Could you add online ordering so customers can pay for pickup orders through the site? We'd also like customer accounts so regulars can save their favourite items.

Also, please swap the hero image on the homepage for the new one our photographer took last week.

One more thing: quite a few of our customers speak Portuguese, so we'd like the site available in Portuguese as well as English.

Finally, can we add a separate page for each of our three locations rather than the single Locations page? That would be three pages instead of one.

Let me know what's involved.

Thanks,
Dana`;

/**
 * Pre-entered estimate hours for the sample, so the demo shows a complete
 * change order rather than an empty table. These are the developer's numbers,
 * exactly as the product requires — the model never supplies hours.
 */
export const SAMPLE_ESTIMATE_HOURS: Record<string, string> = {
  "Configure the identity provider and credentials": "3",
  "Build the sign-in interface": "4",
  "Implement the callback and account-linking flow": "5",
  "Handle error and edge-case states": "2.5",
  "Test across new and existing accounts": "2",
};
