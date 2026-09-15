import assert from "node:assert/strict";
import { test } from "node:test";

import { decryptSecret, encryptSecret } from "./secret-box.ts";

/**
 * The rule this module exists for: a stolen database dump must not yield
 * usable provider tokens. These tests pin the properties behind that claim —
 * round-trip, tamper detection, wrong-key refusal — plus the failure modes
 * a user could actually hit (no key configured, malformed stored value).
 */

async function withKey(key: string | undefined, run: () => void): Promise<void> {
  const saved = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = key;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = saved;
  }
}

test("round-trips a token without the plaintext appearing in the stored value", async () => {
  await withKey("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", () => {
    const packed = encryptSecret("xoxb-secret-bot-token");
    assert.ok(!packed.includes("xoxb-secret-bot-token"), "ciphertext must not contain the token");
    assert.ok(packed.startsWith("v1:"), "packed value names its version");
    assert.equal(decryptSecret(packed), "xoxb-secret-bot-token");
  });
});

test("the same token encrypts to a different stored value every time", async () => {
  await withKey("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", () => {
    const first = encryptSecret("xoxb-token");
    const second = encryptSecret("xoxb-token");
    assert.notEqual(first, second, "a random IV must make encryptions unique");
  });
});

test("a tampered stored value is refused, not partially decrypted", async () => {
  await withKey("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", () => {
    const packed = encryptSecret("xoxb-token");
    const parts = packed.split(":");
    // Flip a byte in the ciphertext.
    const tampered = [parts[0]!, parts[1]!, parts[2]!, Buffer.from("Z".repeat(40)).toString("base64")].join(":");
    assert.throws(() => decryptSecret(tampered), "GCM must catch the substitution");
  });
});

test("a key different from the encrypting one is refused", async () => {
  const packed = await withKeyAndEncrypt();
  await withKey("AAAAQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=", () => {
    assert.throws(() => decryptSecret(packed));
  });
});

test("no key configured is a clear error, not a silent plaintext write", async () => {
  await withKey(undefined, () => {
    assert.throws(() => encryptSecret("xoxb-token"), /INTEGRATION_ENCRYPTION_KEY/);
  });
});

test("a malformed stored value is refused with a format error", async () => {
  await withKey("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", () => {
    assert.throws(() => decryptSecret("not-a-packed-value"), /format/i);
    assert.throws(() => decryptSecret("v2:only:three"), /format/i);
  });
});

/** Encrypt under the standard test key and return the packed value. */
async function withKeyAndEncrypt(): Promise<string> {
  let packed = "";
  await withKey("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", () => {
    packed = encryptSecret("xoxb-token");
  });
  return packed;
}
