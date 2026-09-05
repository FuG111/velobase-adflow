import { reconcilePlanChanges } from "@/modules/ad-entitlements/server/plan-change";
import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { appEvents } from "@/server/events/bus";
import { requireEntitlement } from "./contracts";
import { adflowQueue, type AdsJob } from "@/modules/ad-accounts/worker/queue";
import { tokenFor } from "@/modules/ad-accounts/server/service";
import {
  readMetrics,
  AdsProviderError,
} from "@/modules/ad-accounts/server/providers";
import { snapshotSchema } from "@/modules/ad-accounts/server/schema";
import { evidence } from "@/modules/ad-diagnostics/server/metrics";
import { requestDiagnosis } from "@/modules/ad-diagnostics/server/service";
import { compareBenchmarks } from "@/modules/ad-benchmarks/server/service";
import { generateDiagnosis } from "./ai";
const log = createLogger("adflow-worker");
function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
async function dispatch() {
  await reconcilePlanChanges().catch(() =>
    log.warn("Plan reconciliation will retry"),
  );
  const stale = new Date(Date.now() - 15 * 60000);
  const runs = await db.adsSyncRun.findMany({
    where: {
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", updatedAt: { lt: stale } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  const reports = await db.adsReport.findMany({
    where: {
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", updatedAt: { lt: stale } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  for (const [kind, items] of [
    ["sync", runs],
    ["diagnose", reports],
  ] as const)
    for (const item of items) {
      const jobId = `${kind}-${item.id}`;
      const prior = await adflowQueue.getJob(jobId);
      if (prior && (await prior.getState()) === "failed") await prior.remove();
      await adflowQueue.add(kind, { kind, id: item.id }, { jobId });
    }
  // Reconcile committed snapshots even if the process died before emitting the completion event.
  if (env.OPENAI_API_KEY) {
    const completed = await db.adsSyncRun.findMany({
      where: {
        status: "SUCCEEDED",
        reports: { none: {} },
        account: { status: "BOUND" },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    for (const run of completed)
      await requestDiagnosis(run.userId, run.accountId).catch(() => undefined);
  }
}
async function sync(id: string) {
  const run = await db.adsSyncRun.findUnique({
    where: { id },
    include: { account: { include: { connection: true } } },
  });
  if (!run || run.status === "SUCCEEDED" || run.status === "CANCELLED") return;
  const account = run.account;
  if (account.status !== "BOUND" || account.connection.status !== "ACTIVE")
    throw new AdsProviderError("REAUTH_REQUIRED");
  await requireEntitlement(run.userId);
  await db.adsSyncRun.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING", "FAILED"] } },
    data: { status: "RUNNING", errorCode: null },
  });
  const token = await tokenFor(account.connection);
  const rows = await readMetrics(
    account.platform,
    token,
    { ...account, managerId: account.managerId ?? undefined },
    run.startDate,
    run.endDate,
  );
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.entityId}:${row.date}`;
    if (keys.has(key)) throw new Error("DUPLICATE_METRICS");
    keys.add(key);
  }
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.entityId.localeCompare(b.entityId),
  );
  const snapshot = snapshotSchema.parse({
    rows,
    currency: account.currency,
    timezone: account.timezone,
    startDate: run.startDate,
    endDate: run.endDate,
    attribution:
      account.platform === "META"
        ? "7d_click:conversion_time"
        : "google_account_conversion_settings",
    conversionMetric:
      account.platform === "META"
        ? "offsite_conversion.fb_pixel_purchase"
        : "primary_conversions",
  });
  const hash = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${run.userId}))`;
    await requireEntitlement(run.userId, tx);
    await tx.adsSyncRun.updateMany({
      where: {
        id,
        status: "RUNNING",
        account: { status: "BOUND", connection: { status: "ACTIVE" } },
      },
      data: {
        status: "SUCCEEDED",
        snapshot: jsonValue(snapshot),
        snapshotHash: hash,
      },
    });
  });
  await appEvents.emit("ads:sync-completed", {
    userId: run.userId,
    accountId: run.accountId,
    syncRunId: id,
  });
}
async function diagnose(id: string) {
  const report = await db.adsReport.findUnique({
    where: { id },
    include: { syncRun: true, account: true },
  });
  if (!report || report.status === "SUCCEEDED" || report.status === "CANCELLED")
    return;
  await requireEntitlement(report.userId);
  if (report.account.status !== "BOUND") return;
  await db.adsReport.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING", "FAILED"] } },
    data: { status: "RUNNING", errorCode: null },
  });
  const data = evidence(snapshotSchema.parse(report.syncRun.snapshot));
  const benchmarks = await compareBenchmarks({
    ...report.account,
    attribution: data.attribution,
    endDate: data.endDate,
  });
  const input = { ...data, findings: data.findings.slice(0, 50), benchmarks };
  const result = await generateDiagnosis(input, report.locale);
  const keys = new Set(input.findings.map((f) => f.key));
  if (result.recommendations.some((r) => !keys.has(r.evidenceKey)))
    throw new Error("INVALID_AI_EVIDENCE");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${report.userId}))`;
    await requireEntitlement(report.userId, tx);
    const changed = await tx.adsReport.updateMany({
      where: { id, status: "RUNNING", account: { status: "BOUND" } },
      data: {
        status: "SUCCEEDED",
        summary: result.summary,
        evidence: jsonValue({ ...data, benchmarks }),
        model: env.ADFLOW_AI_MODEL,
      },
    });
    if (!changed.count) return;
    await tx.adsRecommendation.deleteMany({ where: { reportId: id } });
    await tx.adsRecommendation.createMany({
      data: result.recommendations.map((r) => ({
        ...r,
        userId: report.userId,
        reportId: id,
        steps: jsonValue(r.steps),
      })),
    });
  });
  await appEvents.emit("ads:diagnosis-completed", {
    userId: report.userId,
    accountId: report.accountId,
    reportId: id,
  });
}
export async function processAdflowJob(job: Job<AdsJob>): Promise<void> {
  try {
    if (job.data.kind === "dispatch") await dispatch();
    else if (job.data.kind === "sync") await sync(job.data.id);
    else await diagnose(job.data.id);
  } catch (error) {
    const code =
      error instanceof AdsProviderError ? error.code : "PROCESSING_FAILED";
    log.warn(
      { kind: job.data.kind, id: job.data.id, code, attempt: job.attemptsMade },
      "AdFlow job failed",
    );
    if (job.data.kind === "sync" && code === "REAUTH_REQUIRED") {
      const run = await db.adsSyncRun.findUnique({
        where: { id: job.data.id },
        select: { account: { select: { connectionId: true } } },
      });
      if (run)
        await db.adsConnection.updateMany({
          where: { id: run.account.connectionId, status: "ACTIVE" },
          data: { status: "REAUTH_REQUIRED" },
        });
    }
    if (job.data.kind !== "dispatch") {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const data = {
        status: final ? ("FAILED" as const) : ("RUNNING" as const),
        errorCode: code,
      };
      const where = {
        id: job.data.id,
        status: {
          notIn: ["CANCELLED", "SUCCEEDED"] as ("CANCELLED" | "SUCCEEDED")[],
        },
      };
      if (job.data.kind === "sync")
        await db.adsSyncRun.updateMany({ where, data });
      else await db.adsReport.updateMany({ where, data });
    }
    throw new Error(code); // Never let BullMQ persist provider errors or credentials.
  }
}
