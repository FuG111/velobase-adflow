import { evidence } from "./metrics";
import type { Snapshot } from "@/modules/ad-accounts/server/schema";
// Fixed, synthetic dataset. It never enters account tables, jobs, payments or AI requests.
export function demoEvidence() {
  const rows: Snapshot["rows"] = [];
  const names = [
    "Brand · Search",
    "Prospecting · Video",
    "Retargeting · Carousel",
    "Summer · Discovery",
  ];
  for (let day = 0; day < 60; day++) {
    const date = new Date(Date.UTC(2026, 5, 1 + day))
      .toISOString()
      .slice(0, 10);
    for (let n = 0; n < 4; n++)
      rows.push({
        date,
        entityId: `demo-${n}`,
        name: names[n]!,
        campaign: n < 2 ? "Acquisition" : "Retention",
        group: "Summer 2026",
        impressions: 1800 + n * 350 + day * 13,
        clicks: 85 - n * 9 + (day % 7) * 3,
        spendMicros: (48 + n * 22 + (day % 5) * 4) * 1000000,
        conversions: n === 1 && day >= 30 ? 0 : 3 + (day % 3),
        conversionValue: n === 1 && day >= 30 ? 0 : (3 + (day % 3)) * 75,
      });
  }
  return evidence({
    rows,
    startDate: "2026-06-01",
    endDate: "2026-07-30",
    currency: "USD",
    timezone: "America/Los_Angeles",
    attribution: "synthetic_demo",
    conversionMetric: "demo_purchases",
  });
}
