import type { DailyRow, Snapshot } from "@/modules/ad-accounts/server/schema";
export function aggregate(rows: DailyRow[]) {
  const total = rows.reduce(
    (a, r) => ({
      spend: a.spend + r.spendMicros / 1000000,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      conversions: a.conversions + (r.conversions ?? 0),
      value: a.value + (r.conversionValue ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 },
  );
  const hasConversions =
    rows.length > 0 && rows.every((r) => r.conversions !== null);
  const hasValue =
    rows.length > 0 && rows.every((r) => r.conversionValue !== null);
  return {
    ...total,
    conversions: hasConversions ? total.conversions : null,
    value: hasValue ? total.value : null,
    ctr: total.impressions ? (total.clicks / total.impressions) * 100 : null,
    cpc: total.clicks ? total.spend / total.clicks : null,
    cvr:
      hasConversions && total.clicks
        ? (total.conversions / total.clicks) * 100
        : null,
    cpa:
      hasConversions && total.conversions
        ? total.spend / total.conversions
        : null,
    roas: hasValue && total.spend ? total.value / total.spend : null,
  };
}
export function evidence(snapshot: Snapshot) {
  const cutoffDate = new Date(`${snapshot.endDate}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 29);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  const current = snapshot.rows.filter((r) => r.date >= cutoff);
  const previous = snapshot.rows.filter((r) => r.date < cutoff);
  const metrics = aggregate(current),
    baseline = aggregate(previous);
  const groups = new Map<string, DailyRow[]>();
  const priorGroups = new Map<string, DailyRow[]>();
  for (const [collection, rows] of [
    [groups, current],
    [priorGroups, previous],
  ] as const) {
    for (const row of rows) {
      const bucket = collection.get(row.entityId) ?? [];
      bucket.push(row);
      collection.set(row.entityId, bucket);
    }
  }
  const findings = [...groups]
    .map(([id, rows]) => {
      const stats = aggregate(rows);
      const prior = aggregate(priorGroups.get(id) ?? []);
      const flags: string[] = [];
      if (stats.conversions === null) flags.push("MISSING_CONVERSIONS");
      if (stats.clicks >= 100 && stats.conversions === 0 && stats.spend > 0)
        flags.push("SPEND_WITHOUT_CONVERSIONS");
      if (
        stats.impressions >= 1000 &&
        prior.impressions >= 1000 &&
        prior.ctr &&
        stats.ctr !== null &&
        stats.ctr < prior.ctr * 0.7
      )
        flags.push("CTR_DECLINE");
      if (
        stats.conversions !== null &&
        stats.conversions >= 10 &&
        stats.cpa &&
        metrics.cpa &&
        stats.cpa > metrics.cpa * 1.5
      )
        flags.push("HIGH_CPA");
      return {
        key: id,
        name: rows[0]!.name,
        campaign: rows[0]!.campaign,
        group: rows[0]!.group,
        metrics: stats,
        previous: prior,
        flags,
      };
    })
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
  return {
    metrics,
    previous: baseline,
    currentStart: cutoff,
    endDate: snapshot.endDate,
    currency: snapshot.currency,
    timezone: snapshot.timezone,
    attribution: snapshot.attribution,
    conversionMetric: snapshot.conversionMetric,
    findings,
    dataPoints: current.length,
    ruleVersion: "1",
  };
}
