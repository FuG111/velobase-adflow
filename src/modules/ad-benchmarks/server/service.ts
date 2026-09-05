import { z } from "zod";
import { db } from "@/server/db";
import { platformSchema } from "@/modules/ad-accounts/server/schema";
export const benchmarkSchema = z
  .object({
    platform: platformSchema,
    industry: z.string().trim().min(1).max(60),
    region: z.string().regex(/^[A-Z]{2}$|^GLOBAL$/),
    objective: z.enum(["CONVERSIONS", "LEADS", "TRAFFIC", "AWARENESS"]),
    currency: z.string().length(3),
    attribution: z.string().min(1).max(100),
    metric: z.enum(["ctr", "cpc", "cvr", "cpa", "roas"]),
    value: z.number().finite().nonnegative(),
    sourceUrl: z
      .string()
      .url()
      .refine((url) => new URL(url).protocol === "https:"),
    licenseNote: z.string().min(1).max(2000),
    sampleSize: z.number().int().positive(),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    published: z.boolean().default(true),
  })
  .refine((x) => x.periodStart <= x.periodEnd, "Invalid period");
export async function compareBenchmarks(input: {
  platform: "GOOGLE" | "META";
  industry: string;
  region: string;
  objective: string;
  currency: string;
  attribution: string;
  endDate: string;
}) {
  const oldest = new Date(`${input.endDate}T00:00:00Z`);
  oldest.setUTCMonth(oldest.getUTCMonth() - 12);
  return db.adsBenchmark.findMany({
    where: {
      platform: input.platform,
      industry: input.industry,
      region: input.region,
      objective: input.objective,
      currency: input.currency,
      attribution: input.attribution,
      published: true,
      periodEnd: { gte: oldest.toISOString().slice(0, 10), lte: input.endDate },
    },
    orderBy: { periodEnd: "desc" },
    take: 20,
  });
}
export async function publishBenchmark(input: z.infer<typeof benchmarkSchema>) {
  return db.adsBenchmark.create({ data: input });
}
export async function retireBenchmark(id: string) {
  return db.adsBenchmark.update({ where: { id }, data: { published: false } });
}
