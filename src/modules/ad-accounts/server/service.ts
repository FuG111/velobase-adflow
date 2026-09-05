import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { redis } from "@/server/redis";
import { env } from "@/env";
import { appEvents } from "@/server/events/bus";
import { requireEntitlement } from "@/server/adflow/contracts";
import { encryptCredentials, decryptCredentials } from "./crypto";
import {
  accessToken,
  discover,
  exchangeCode,
  authorizationUrl,
  credentialsSchema,
  providerReady,
  AdsProviderError,
} from "./providers";
import {
  type Platform,
  type pageSchema,
  type bindSchema,
  discoveredSchema,
} from "./schema";

export const publicConnection = {
  id: true,
  platform: true,
  status: true,
  createdAt: true,
} as const;
export async function connection(userId: string, id: string) {
  const item = await db.adsConnection.findFirst({
    where: { id, userId, status: "ACTIVE" },
  });
  if (!item)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "CONNECTION_UNAVAILABLE",
    });
  return item;
}
export async function tokenFor(item: Awaited<ReturnType<typeof connection>>) {
  try {
    return await accessToken(
      item.platform,
      credentialsSchema.parse(
        JSON.parse(
          decryptCredentials(
            item.credentials,
            env.ADFLOW_CREDENTIAL_ENCRYPTION_KEY!,
          ),
        ),
      ),
    );
  } catch (error) {
    if (error instanceof AdsProviderError && error.code === "REAUTH_REQUIRED")
      await db.adsConnection.updateMany({
        where: { id: item.id, status: "ACTIVE" },
        data: { status: "REAUTH_REQUIRED" },
      });
    throw error;
  }
}
export async function beginAuthorization(userId: string, platform: Platform) {
  const state = randomBytes(32).toString("hex");
  const url = authorizationUrl(platform, state);
  await redis.set(
    `adflow:oauth:${state}`,
    JSON.stringify({ userId, platform }),
    "EX",
    600,
  );
  return { url };
}
export async function finishAuthorization(
  userId: string,
  platform: Platform,
  state: string,
  code: string,
) {
  if (!/^[a-f0-9]{64}$/.test(state) || !providerReady(platform))
    throw new Error("INVALID_OAUTH_STATE");
  // Atomic consume only by the initiating signed-in user. A foreign session cannot burn the state.
  const raw = await redis.eval(
    "local v=redis.call('GET',KEYS[1]); if not v then return nil end; local p=cjson.decode(v); if p.userId~=ARGV[1] or p.platform~=ARGV[2] then return nil end; redis.call('DEL',KEYS[1]); return v",
    1,
    `adflow:oauth:${state}`,
    userId,
    platform,
  );
  if (!raw) throw new Error("INVALID_OAUTH_STATE");
  const result = await exchangeCode(platform, code);
  const credentials = encryptCredentials(
    JSON.stringify(result.credentials),
    env.ADFLOW_CREDENTIAL_ENCRYPTION_KEY!,
  );
  await db.adsConnection.upsert({
    where: {
      userId_platform_externalIdentity: {
        userId,
        platform,
        externalIdentity: result.identity,
      },
    },
    create: {
      userId,
      platform,
      externalIdentity: result.identity,
      credentials,
    },
    update: { credentials, status: "ACTIVE" },
  });
}
export async function listConnections(
  userId: string,
  input: z.infer<typeof pageSchema>,
) {
  const rows = await db.adsConnection.findMany({
    where: { userId },
    select: publicConnection,
    orderBy: { id: "asc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  return paginate(rows, input.limit);
}
export function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: more ? items.at(-1)?.id : undefined };
}
export async function discoverAccounts(userId: string, id: string) {
  const item = await connection(userId, id);
  const accounts = await discover(item.platform, await tokenFor(item));
  // Discovery is bounded provider data. Cache is user+connection scoped for subsequent paginated reads and binding verification.
  await redis.set(
    `adflow:discovery:${userId}:${id}`,
    JSON.stringify(accounts),
    "EX",
    600,
  );
  return { count: accounts.length };
}
export async function discoveredAccounts(
  userId: string,
  id: string,
  cursor?: string,
) {
  await connection(userId, id);
  const raw = await redis.get(`adflow:discovery:${userId}:${id}`);
  const items = raw ? z.array(discoveredSchema).parse(JSON.parse(raw)) : [];
  const sorted = items
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .filter((a) => !cursor || a.externalId > cursor);
  return {
    items: sorted.slice(0, 20),
    nextCursor: sorted.length > 20 ? sorted[19]?.externalId : undefined,
  };
}
export async function bindAccount(
  userId: string,
  input: z.infer<typeof bindSchema>,
) {
  const item = await connection(userId, input.connectionId);
  // Always verify provider ownership again; never accept a client-supplied name/currency/customer ID as proof.
  const available = await discover(item.platform, await tokenFor(item));
  const chosen = available.find((a) => a.externalId === input.externalId);
  if (!chosen) throw new TRPCError({ code: "FORBIDDEN" });
  const account = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const source = await tx.adsConnection.findFirst({
        where: { id: item.id, userId, status: "ACTIVE" },
      });
      if (!source) throw new TRPCError({ code: "NOT_FOUND" });
      const allowance = await requireEntitlement(userId, tx);
      const existing = await tx.adsAccount.findUnique({
        where: {
          userId_platform_externalId: {
            userId,
            platform: item.platform,
            externalId: chosen.externalId,
          },
        },
      });
      if (existing?.status !== "BOUND" && allowance.used >= allowance.limit)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ACCOUNT_LIMIT_REACHED",
        });
      const data = {
        ...chosen,
        managerId: chosen.managerId ?? null,
        connectionId: item.id,
        industry: input.industry,
        region: input.region,
        objective: input.objective,
        status: "BOUND" as const,
      };
      return tx.adsAccount.upsert({
        where: {
          userId_platform_externalId: {
            userId,
            platform: item.platform,
            externalId: chosen.externalId,
          },
        },
        create: { ...data, userId, platform: item.platform },
        update: data,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
  await requestSync(userId, account.id);
  await appEvents.emit("ads:account-bound", { userId, accountId: account.id });
  return account;
}
export async function ownedAccount(userId: string, id: string) {
  const item = await db.adsAccount.findFirst({
    where: { userId, id },
    include: { connection: true },
  });
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  return item;
}
export async function listAccounts(
  userId: string,
  input: z.infer<typeof pageSchema>,
) {
  const rows = await db.adsAccount.findMany({
    where: { userId },
    orderBy: { id: "asc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { connection: { select: { status: true } } },
  });
  return paginate(rows, input.limit);
}
export async function disconnectAccount(
  userId: string,
  id: string,
  remove = false,
) {
  await ownedAccount(userId, id);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    if (remove) await tx.adsAccount.deleteMany({ where: { userId, id } });
    else {
      await tx.adsAccount.updateMany({
        where: { userId, id },
        data: { status: "DISCONNECTED" },
      });
      await tx.adsSyncRun.updateMany({
        where: { userId, accountId: id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "CANCELLED" },
      });
      await tx.adsReport.updateMany({
        where: { userId, accountId: id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "CANCELLED" },
      });
    }
  });
  return { ok: true };
}
export async function revokeConnection(userId: string, id: string) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const found = await tx.adsConnection.findFirst({ where: { id, userId } });
    if (!found) throw new TRPCError({ code: "NOT_FOUND" });
    await tx.adsConnection.update({
      where: { id },
      data: { status: "REVOKED", credentials: "" },
    });
    await tx.adsAccount.updateMany({
      where: { userId, connectionId: id },
      data: { status: "DISCONNECTED" },
    });
    await tx.adsSyncRun.updateMany({
      where: {
        userId,
        account: { connectionId: id },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.adsReport.updateMany({
      where: {
        userId,
        account: { connectionId: id },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
  });
  return { ok: true };
}
export function syncRange(timezone: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 59);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
export async function requestSync(userId: string, accountId: string) {
  const account = await ownedAccount(userId, accountId);
  if (account.status !== "BOUND" || account.connection.status !== "ACTIVE")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "REAUTH_REQUIRED",
    });
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    await requireEntitlement(userId, tx);
    const pending = await tx.adsSyncRun.findFirst({
      where: { userId, accountId, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (pending) return pending;
    const recent = await tx.adsSyncRun.count({
      where: {
        userId,
        accountId,
        createdAt: { gt: new Date(Date.now() - 3600000) },
      },
    });
    if (recent >= 3) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    // Durable DB outbox: worker scheduler repairs missed queue submissions.
    return tx.adsSyncRun.create({
      data: { userId, accountId, ...syncRange(account.timezone) },
    });
  });
}
export async function listRuns(
  userId: string,
  accountId: string,
  input: z.infer<typeof pageSchema>,
) {
  await ownedAccount(userId, accountId);
  return paginate(
    await db.adsSyncRun.findMany({
      where: { userId, accountId },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { id: "desc" },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    }),
    input.limit,
  );
}
