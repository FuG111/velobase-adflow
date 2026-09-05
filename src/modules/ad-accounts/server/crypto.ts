import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function encryptCredentials(value: string, hexKey: string) {
  if (!/^[a-f\d]{64}$/i.test(hexKey))
    throw new Error("ADFLOW_ENCRYPTION_CONFIG");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function decryptCredentials(value: string, hexKey: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  if (!iv || !tag || !data) throw new Error("INVALID_CREDENTIALS");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(hexKey, "hex"),
    iv,
  );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
