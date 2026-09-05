// Public composition facade: API adapters do not import other modules' internals.
export { entitlement, plans } from "@/modules/ad-entitlements/server/service";
export {
  reportInput,
  requestDiagnosis,
  listReports,
  getReport,
  setRecommendation,
} from "@/modules/ad-diagnostics/server/service";
export {
  benchmarkSchema,
  publishBenchmark,
  retireBenchmark,
} from "@/modules/ad-benchmarks/server/service";

export {
  scheduleDowngrade,
  pendingPlanChange,
} from "@/modules/ad-entitlements/server/plan-change";

import { db } from "@/server/db";
import { ownedAccount } from "@/modules/ad-accounts/server/service";
import { snapshotSchema } from "@/modules/ad-accounts/server/schema";
import { evidence } from "@/modules/ad-diagnostics/server/metrics";
export async function accountMetrics(userId: string, accountId: string) {
  await ownedAccount(userId, accountId);
  const latest = await db.adsSyncRun.findFirst({
    where: { userId, accountId, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
  });
  return latest?.snapshot
    ? evidence(snapshotSchema.parse(latest.snapshot))
    : null;
}
