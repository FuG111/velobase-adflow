import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, evidence } from "./metrics";
import {
  snapshotSchema,
  type DailyRow,
} from "@/modules/ad-accounts/server/schema";
const row: DailyRow = {
  date: "2026-07-01",
  entityId: "1",
  name: "Test",
  campaign: "Campaign",
  group: "Group",
  impressions: 1000,
  clicks: 100,
  spendMicros: 100000000,
  conversions: 10,
  conversionValue: 500,
};
void test("should calculate weighted metrics rather than average row ratios", () => {
  const m = aggregate([
    row,
    {
      ...row,
      impressions: 9000,
      clicks: 100,
      conversions: 0,
      spendMicros: 50000000,
      conversionValue: 0,
    },
  ]);
  assert.equal(m.ctr, 2);
  assert.equal(m.cpc, 0.75);
  assert.equal(m.cpa, 15);
  assert.equal(m.roas, 500 / 150);
});
void test("should preserve missing conversion data and zero denominators", () => {
  const m = aggregate([
    {
      ...row,
      conversions: null,
      conversionValue: null,
      clicks: 0,
      impressions: 0,
      spendMicros: 0,
    },
  ]);
  for (const key of [
    "ctr",
    "cpc",
    "cpa",
    "cvr",
    "roas",
    "conversions",
    "value",
  ] as const)
    assert.equal(m[key], null);
  assert.equal(aggregate([]).conversions, null);
});
void test("should not diagnose missing conversions as zero conversions", () => {
  const snapshot = snapshotSchema.parse({
    rows: [{ ...row, conversions: null }],
    startDate: "2026-06-01",
    endDate: "2026-07-30",
    currency: "USD",
    timezone: "UTC",
    attribution: "test",
    conversionMetric: "purchases",
  });
  const result = evidence(snapshot);
  assert.deepEqual(result.findings[0]?.flags, ["MISSING_CONVERSIONS"]);
  assert.equal(result.currentStart, "2026-07-01");
});
void test("should compare aligned 30 day windows and identify zero-conversion spend", () => {
  const snapshot = snapshotSchema.parse({
    rows: [
      { ...row, date: "2026-06-15" },
      { ...row, conversions: 0 },
    ],
    startDate: "2026-06-01",
    endDate: "2026-07-30",
    currency: "USD",
    timezone: "UTC",
    attribution: "test",
    conversionMetric: "purchases",
  });
  const result = evidence(snapshot);
  assert.equal(result.previous.conversions, 10);
  assert.equal(result.metrics.conversions, 0);
  assert.ok(result.findings[0]?.flags.includes("SPEND_WITHOUT_CONVERSIONS"));
});
void test("should reject negative, unsafe or malformed provider metrics", () => {
  assert.equal(
    snapshotSchema.safeParse({ rows: [{ ...row, spendMicros: -1 }] }).success,
    false,
  );
});
