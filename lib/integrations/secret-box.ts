/**
 * Encryption for user-provided integration tokens at rest.
 *
 * AES-256-GCM with a key held only in the server environment
 * (INTEGRATION_ENCRYPTION_KEY — 32 bytes, base64). The rule this module
 * enforces: a stolen database dump must not yield usable provider tokens.
 * The corollary is accepted deliberately — losing the key loses the
 * connections (users re-connect); it never exposes them.
 *
 * Packed format "v1:<iv>:<authTag>:<ciphertext>" (all base64), so the scheme
 * can be rotated later without a migration: a future v2 writer reads v1 fine
 * by dispatching on the prefix.
 */

import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = (process.env.INTEGRATION_ENCRYPTION_KEY ?? "").trim();
  if (raw === "") {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it before connecting integrations.",
    );
  }

  const buffer = Buffer.from(raw, "base64");
  if (buffer.length !== 32) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be 32 bytes of base64 — generate one with `openssl rand -base64 32`.",
    );
  }
  return buffer;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(packed: string): string {
  const [version, iv, tag, ciphertext] = packed.split(":");
  if (version !== "v1" || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error("Stored credential is not in a recognized format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
