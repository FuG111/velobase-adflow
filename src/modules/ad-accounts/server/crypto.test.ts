import assert from "node:assert/strict";
import test from "node:test";
import { encryptCredentials, decryptCredentials } from "./crypto";
const key = "ab".repeat(32);
void test("should encrypt credentials with fresh nonces and authenticate decryption", () => {
  const a = encryptCredentials("private-token", key),
    b = encryptCredentials("private-token", key);
  assert.notEqual(a, b);
  assert.ok(!a.includes("private-token"));
  assert.equal(decryptCredentials(a, key), "private-token");
});
void test("should reject altered ciphertext, wrong keys and invalid key configuration", () => {
  const a = encryptCredentials("token", key);
  assert.throws(() => decryptCredentials(a, "cd".repeat(32)));
  assert.throws(() => decryptCredentials(a.slice(0, -2) + "xx", key));
  assert.throws(() => encryptCredentials("token", "short"));
});
