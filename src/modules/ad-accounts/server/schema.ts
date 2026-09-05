import { z } from "zod";
export const platformSchema = z.enum(["GOOGLE", "META"]);
export const idSchema = z.object({ id: z.string().cuid() });
export const pageSchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const accountInput = z.object({ accountId: z.string().cuid() });
export const discoveredSchema = z.object({
  externalId: z.string().regex(/^\d+$/),
  managerId: z.string().regex(/^\d+$/).optional(),
  name: z.string().max(500),
  currency: z.string().length(3),
  timezone: z.string().max(100),
});
export const bindSchema = z.object({
  connectionId: z.string().cuid(),
  externalId: z.string().regex(/^\d+$/),
  industry: z.string().trim().min(1).max(60).default("general"),
  region: z
    .string()
    .regex(/^[A-Z]{2}$|^GLOBAL$/)
    .default("GLOBAL"),
  objective: z
    .enum(["CONVERSIONS", "LEADS", "TRAFFIC", "AWARENESS"])
    .default("CONVERSIONS"),
});
export const dailyRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityId: z.string().max(100),
  name: z.string().max(500),
  campaign: z.string().max(500),
  group: z.string().max(500),
  impressions: z.number().int().nonnegative().safe(),
  clicks: z.number().int().nonnegative().safe(),
  spendMicros: z.number().int().nonnegative().safe(),
  conversions: z.number().nonnegative().nullable(),
  conversionValue: z.number().nonnegative().nullable(),
});
export const snapshotSchema = z.object({
  rows: z.array(dailyRowSchema).max(100000),
  attribution: z.string(),
  currency: z.string().length(3),
  timezone: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  conversionMetric: z.string(),
});
export type DailyRow = z.infer<typeof dailyRowSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type DiscoveredAccount = z.infer<typeof discoveredSchema>;
