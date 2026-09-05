import { env } from "@/env";

export const APP_NAME = env.NEXT_PUBLIC_APP_NAME ?? "AdFlow";
export const SUPPORT_EMAIL =
  env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@yourdomain.com";

export function supportMailto(subject?: string) {
  const suffix = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${SUPPORT_EMAIL}${suffix}`;
}
