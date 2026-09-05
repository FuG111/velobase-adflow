import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "@/server/api/trpc";
import { isModuleEnabled } from "@/config/modules";
import { createLogger } from "@/lib/logger";
import {
  platformSchema,
  pageSchema,
  idSchema,
  accountInput,
  bindSchema,
} from "./schema";
import * as service from "./service";
import { providerReady, AdsProviderError } from "./providers";
import { env } from "@/env";
import * as product from "@/server/adflow/api-services";
const log = createLogger("adflow-router");
const guard = async <T>(call: () => Promise<T>) => {
  if (!isModuleEnabled("adflow")) throw new TRPCError({ code: "NOT_FOUND" });
  try {
    return await call();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const message =
      error instanceof AdsProviderError ? error.code : "ADFLOW_REQUEST_FAILED";
    log.warn({ code: message }, "Request failed");
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
};
const p = protectedProcedure.use(async ({ ctx, next, type }) => {
  if (!isModuleEnabled("adflow")) throw new TRPCError({ code: "NOT_FOUND" });
  if (type === "mutation") {
    const { getUserRateLimiter } = await import("@/server/ratelimit");
    try {
      await getUserRateLimiter("FREE").consume(ctx.session.user.id);
    } catch {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    }
  }
  return next();
});
export const adflowRouter = createTRPCRouter({
  status: p.query(({ ctx }) =>
    guard(async () => ({
      google: providerReady("GOOGLE"),
      meta: providerReady("META"),
      ai: Boolean(env.OPENAI_API_KEY),
      entitlement: await product.entitlement(ctx.session.user.id),
    })),
  ),
  scheduleDowngrade: p
    .input(z.object({ productId: z.string().min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      guard(() =>
        product.scheduleDowngrade(ctx.session.user.id, input.productId),
      ),
    ),
  pendingPlanChange: p.query(({ ctx }) =>
    guard(() => product.pendingPlanChange(ctx.session.user.id)),
  ),
  plans: p.query(() => guard(product.plans)),
  connections: p
    .input(pageSchema)
    .query(({ ctx, input }) =>
      guard(() => service.listConnections(ctx.session.user.id, input)),
    ),
  authorize: p
    .input(z.object({ platform: platformSchema }))
    .mutation(({ ctx, input }) =>
      guard(() =>
        service.beginAuthorization(ctx.session.user.id, input.platform),
      ),
    ),
  discover: p
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      guard(() => service.discoverAccounts(ctx.session.user.id, input.id)),
    ),
  discovered: p
    .input(idSchema.extend({ cursor: z.string().regex(/^\d+$/).optional() }))
    .query(({ ctx, input }) =>
      guard(() =>
        service.discoveredAccounts(ctx.session.user.id, input.id, input.cursor),
      ),
    ),
  bind: p
    .input(bindSchema)
    .mutation(({ ctx, input }) =>
      guard(() => service.bindAccount(ctx.session.user.id, input)),
    ),
  accounts: p
    .input(pageSchema)
    .query(({ ctx, input }) =>
      guard(() => service.listAccounts(ctx.session.user.id, input)),
    ),
  disconnect: p
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      guard(() => service.disconnectAccount(ctx.session.user.id, input.id)),
    ),
  deleteData: p
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      guard(() =>
        service.disconnectAccount(ctx.session.user.id, input.id, true),
      ),
    ),
  revoke: p
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      guard(() => service.revokeConnection(ctx.session.user.id, input.id)),
    ),
  sync: p
    .input(accountInput)
    .mutation(({ ctx, input }) =>
      guard(() => service.requestSync(ctx.session.user.id, input.accountId)),
    ),
  runs: p
    .input(pageSchema.merge(accountInput))
    .query(({ ctx, input }) =>
      guard(() =>
        service.listRuns(ctx.session.user.id, input.accountId, input),
      ),
    ),
  diagnose: p
    .input(product.reportInput)
    .mutation(({ ctx, input }) =>
      guard(() =>
        product.requestDiagnosis(
          ctx.session.user.id,
          input.accountId,
          input.locale,
        ),
      ),
    ),
  metrics: p
    .input(accountInput)
    .query(({ ctx, input }) =>
      guard(() => product.accountMetrics(ctx.session.user.id, input.accountId)),
    ),
  reports: p
    .input(accountInput.extend({ cursor: z.string().cuid().optional() }))
    .query(({ ctx, input }) =>
      guard(() =>
        product.listReports(ctx.session.user.id, input.accountId, input.cursor),
      ),
    ),
  report: p
    .input(idSchema)
    .query(({ ctx, input }) =>
      guard(() => product.getReport(ctx.session.user.id, input.id)),
    ),
  recommendation: p
    .input(
      idSchema.extend({ status: z.enum(["OPEN", "ACCEPTED", "DISMISSED"]) }),
    )
    .mutation(({ ctx, input }) =>
      guard(() =>
        product.setRecommendation(ctx.session.user.id, input.id, input.status),
      ),
    ),
  publishBenchmark: adminProcedure
    .input(product.benchmarkSchema)
    .mutation(({ input }) => guard(() => product.publishBenchmark(input))),
  retireBenchmark: adminProcedure
    .input(idSchema)
    .mutation(({ input }) => guard(() => product.retireBenchmark(input.id))),
});
