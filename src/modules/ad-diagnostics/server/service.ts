import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { env } from "@/env";
import { z } from "zod";
import { requireEntitlement } from "@/server/adflow/contracts";
import { appEvents } from "@/server/events/bus";
export const reportInput = z.object({
  accountId: z.string().cuid(),
  locale: z.enum(["en", "zh"]).default("zh"),
});
export async function requestDiagnosis(
  userId: string,
  accountId: string,
  locale = "zh",
) {
  if (!env.OPENAI_API_KEY)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI_NOT_CONFIGURED",
    });
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      await requireEntitlement(userId, tx);
      const account = await tx.adsAccount.findFirst({
        where: { id: accountId, userId, status: "BOUND" },
      });
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      const run = await tx.adsSyncRun.findFirst({
        where: { userId, accountId, status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
      });
      if (!run?.snapshotHash)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SYNC_REQUIRED",
        });
      const unique = {
        accountId,
        snapshotHash: run.snapshotHash,
        ruleVersion: "1",
        locale,
      };
      const existing = await tx.adsReport.findUnique({
        where: { accountId_snapshotHash_ruleVersion_locale: unique },
      });
      if (existing && existing.status !== "FAILED") return existing;
      if (existing && existing.updatedAt > new Date(Date.now() - 60000))
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      const recent = await tx.adsReport.count({
        where: {
          userId,
          accountId,
          createdAt: { gt: new Date(Date.now() - 86400000) },
        },
      });
      if (!existing && recent >= env.ADFLOW_MAX_DAILY_REPORTS)
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      return tx.adsReport.upsert({
        where: { accountId_snapshotHash_ruleVersion_locale: unique },
        create: { ...unique, userId, syncRunId: run.id },
        update: { status: "QUEUED", errorCode: null },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function getReport(userId: string, id: string) {
  const report = await db.adsReport.findFirst({
    where: { id, userId },
    include: { recommendations: { orderBy: { id: "asc" }, take: 20 } },
  });
  if (!report) throw new TRPCError({ code: "NOT_FOUND" });
  return report;
}
export async function listReports(
  userId: string,
  accountId: string,
  cursor?: string,
) {
  const items = await db.adsReport.findMany({
    where: { userId, accountId },
    select: {
      id: true,
      status: true,
      summary: true,
      createdAt: true,
      errorCode: true,
    },
    orderBy: { id: "desc" },
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return {
    items: items.slice(0, 20),
    nextCursor: items.length > 20 ? items[19]?.id : undefined,
  };
}
export async function setRecommendation(
  userId: string,
  id: string,
  status: "OPEN" | "ACCEPTED" | "DISMISSED",
) {
  const result = await db.adsRecommendation.updateMany({
    where: { id, userId },
    data: { status },
  });
  if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
  await appEvents.emit("ads:recommendation-updated", {
    userId,
    recommendationId: id,
  });
  return { ok: true };
}
