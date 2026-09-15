import assert from "node:assert/strict";
import { test } from "node:test";

import { canApproveInternally, sendGate, type RosterEntry } from "./approvals.ts";
import type { MemberRole } from "./types.ts";

function member(role: MemberRole): RosterEntry {
  return { role };
}

test("a solo project never requires internal approval", () => {
  const gate = sendGate([], []);
  assert.equal(gate.required, false);
  assert.equal(gate.satisfied, true);
});

test("viewers alone do not trigger the gate", () => {
  const gate = sendGate([member("viewer"), member("viewer")], []);
  assert.equal(gate.required, false);
  assert.equal(gate.satisfied, true);
});

test("an approver on the roster gates sending until they sign off", () => {
  const roster = [member("approver")];
  assert.deepEqual(sendGate(roster, []), { required: true, satisfied: false });

  const signed = sendGate(roster, [{ decision: "approved" }]);
  assert.deepEqual(signed, { required: true, satisfied: true });
});

test("an admin teammate also counts as an approver", () => {
  const gate = sendGate([member("admin")], []);
  assert.equal(gate.required, true);
  assert.equal(gate.satisfied, false);
});

test("a changes_requested decision does not satisfy the gate", () => {
  // The reviewer asked for revisions: the sign-off must happen again on the
  // revised documents (and revision clears the old rows anyway).
  const gate = sendGate([member("approver")], [{ decision: "changes_requested" }]);
  assert.equal(gate.required, true);
  assert.equal(gate.satisfied, false);
});

test("only teammates with approval rights can record a sign-off", () => {
  assert.equal(canApproveInternally("approver"), true);
  assert.equal(canApproveInternally("admin"), true);
  // The owner prepared the change order — they cannot be their own second
  // pair of eyes, and a viewer has not been given that authority.
  assert.equal(canApproveInternally("owner"), false);
  assert.equal(canApproveInternally("viewer"), false);
});
