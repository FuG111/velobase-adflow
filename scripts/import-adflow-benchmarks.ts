import "dotenv/config";
import { readFile } from "node:fs/promises";
import { db } from "@/server/db";
import { benchmarkSchema } from "@/modules/ad-benchmarks/server/service";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: pnpm exec tsx scripts/import-adflow-benchmarks.ts <licensed-benchmarks.json>",
  );
try {
  const rows = benchmarkSchema
    .array()
    .max(1000)
    .parse(JSON.parse(await readFile(path, "utf8")));
  for (const row of rows) {
    const {
      platform,
      industry,
      region,
      objective,
      currency,
      attribution,
      metric,
      sourceUrl,
      periodStart,
      periodEnd,
    } = row;
    const where = {
      platform,
      industry,
      region,
      objective,
      currency,
      attribution,
      metric,
      sourceUrl,
      periodStart,
      periodEnd,
    };
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(where)}))`;
      const existing = await tx.adsBenchmark.findFirst({ where });
      if (existing)
        await tx.adsBenchmark.update({ where: { id: existing.id }, data: row });
      else await tx.adsBenchmark.create({ data: row });
    });
  }
} finally {
  await db.$disconnect();
}
