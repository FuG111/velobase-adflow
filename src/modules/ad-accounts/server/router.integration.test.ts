import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
// Run ONLY against an isolated DB using the documented test command.
if (!process.env.ADFLOW_TEST_DATABASE)
  throw new Error(
    "Set ADFLOW_TEST_DATABASE=1 for the isolated integration database",
  );
process.env.ADFLOW_GOOGLE_CLIENT_ID = "test-client";
process.env.ADFLOW_GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ADFLOW_GOOGLE_DEVELOPER_TOKEN = "test-developer";
process.env.ADFLOW_CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
process.env.OPENAI_API_KEY = "test-ai";
let invalidEvidence = false;
let failProviderAuthorization = false;
const mockModule = (
  mock as unknown as {
    module: (
      name: string,
      options: { namedExports: Record<string, unknown> },
    ) => void;
  }
).module.bind(mock);
mockModule(new URL("../../../server/adflow/ai.ts", import.meta.url).href, {
  namedExports: {
    generateDiagnosis: async () => ({
      summary: "Test summary",
      recommendations: [
        {
          evidenceKey: invalidEvidence ? "foreign-ad" : "11",
          title: "Review conversion setup",
          rationale: "Evidence has zero conversions",
          steps: ["Check tracking"],
        },
      ],
    }),
  },
});
let scheduleUpdates = 0;
let remotePrice = "price-current";
let invoicePaid = false;
const periodEnd = Math.floor(Date.now() / 1000) + 86400;
mockModule(
  new URL("../../../server/order/services/stripe/client.ts", import.meta.url)
    .href,
  {
    namedExports: {
      STRIPE_API_VERSION: "2025-09-30.clover",
      getStripe: () => ({
        subscriptions: {
          retrieve: async (id: string) => ({
            id,
            status: "active",
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: {
                    id: remotePrice,
                    currency: "usd",
                    unit_amount: 5000,
                    recurring: { interval: "month" },
                  },
                  quantity: 1,
                  current_period_start: periodEnd - 2592000,
                  current_period_end: periodEnd,
                },
              ],
            },
            latest_invoice: { status: invoicePaid ? "paid" : "open" },
          }),
        },
        prices: { create: async () => ({ id: "price-lower" }) },
        subscriptionSchedules: {
          create: async () => ({ id: "schedule-test", metadata: {} }),
          retrieve: async () => ({ id: "schedule-test", metadata: {} }),
          update: async () => {
            scheduleUpdates++;
            return {};
          },
        },
      }),
    },
  },
);
const { db } = await import("@/server/db");
const { redis } = await import("@/server/redis");
const { adflowQueue } = await import("../worker/queue");
const { adflowRouter } = await import("./router");
const { membershipRouter } = await import("@/server/membership/routers");
const service = await import("./service");
const { encryptCredentials } = await import("./crypto");
const { processAdflowJob } = await import("@/server/adflow/processor");
const { entitlement } =
  await import("@/modules/ad-entitlements/server/service");
const { requestDiagnosis } =
  await import("@/modules/ad-diagnostics/server/service");
const { compareBenchmarks } =
  await import("@/modules/ad-benchmarks/server/service");
import type { Job } from "bullmq";
import type { AdsJob } from "../worker/queue";
const users: string[] = [];
const testProducts: string[] = [];
const testPlans: string[] = [];
const originals = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (failProviderAuthorization) return Response.json({error:{code:190,message:"sensitive-token"}},{status:401});
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (url.includes("oauth2.googleapis.com/token"))
    return Response.json({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_in: 3600,
    });
  if (url.includes("openidconnect.googleapis.com"))
    return Response.json({ sub: "oauth-test" });
  if (url.includes("listAccessibleCustomers"))
    return Response.json({ resourceNames: ["customers/1"] });
  if (
    url.includes("googleAds:search") &&
    (typeof init?.body === "string" ? init.body : "").includes(
      "FROM ad_group_ad",
    )
  ) {
    const query = JSON.parse(
      typeof init?.body === "string" ? init.body : "",
    ) as { query: string };
    const date = /AND '([0-9-]+)'/.exec(query.query)?.[1];
    return Response.json({
      results: [
        {
          segments: { date },
          campaign: { name: "Campaign" },
          adGroup: { name: "Group" },
          adGroupAd: { ad: { id: "11", name: "Test" } },
          metrics: {
            impressions: "1000",
            clicks: "100",
            costMicros: "100000000",
            conversions: 0,
            conversionsValue: 0,
          },
        },
      ],
    });
  }
  if (url.includes("googleAds:search"))
    return Response.json({
      results: [
        {
          customerClient: {
            id: "11",
            descriptiveName: "Test A",
            currencyCode: "USD",
            timeZone: "UTC",
          },
        },
        {
          customerClient: {
            id: "22",
            descriptiveName: "Test B",
            currencyCode: "USD",
            timeZone: "UTC",
          },
        },
      ],
    });
  throw new Error("Unexpected external fetch in test");
};
function context(id?: string) {
  return {
    db,
    headers: new Headers(),
    clientIp: "127.0.0.1",
    session: id
      ? { user: { id }, expires: new Date(Date.now() + 60000).toISOString() }
      : null,
  } as Parameters<typeof adflowRouter.createCaller>[0];
}
function job(kind: "sync" | "diagnose", id: string) {
  return {
    data: { kind, id },
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as Job<AdsJob>;
}
after(async () => {
  globalThis.fetch = originals;
  await db.adsPlanChange.deleteMany({ where: { userId: { in: users } } });
  await db.productSubscription.deleteMany({
    where: { productId: { in: testProducts } },
  });
  await db.product.deleteMany({ where: { id: { in: testProducts } } });
  await db.subscriptionPlan.deleteMany({ where: { id: { in: testPlans } } });
  await db.adsConnection.deleteMany({ where: { userId: { in: users } } });
  await db.userSubscriptionCycle.deleteMany({
    where: { subscription: { userId: { in: users } } },
  });
  await db.userSubscription.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await adflowQueue.close();
  await redis.quit();
  await db.$disconnect();
});
void test("should enforce ownership, quota, durable sync and report idempotency through real persistence", async (t) => {
  const owner = await db.user.create({ data: { name: "AdFlow test owner" } }),
    other = await db.user.create({ data: { name: "AdFlow test other" } });
  users.push(owner.id, other.id);
  const sub = await db.userSubscription.create({
    data: {
      userId: owner.id,
      planId: "isolated-test-plan",
      planSnapshot: { metadata: { adflow: true, accountLimit: 1 } },
      status: "ACTIVE",
    },
  });
  await db.userSubscriptionCycle.create({
    data: {
      subscriptionId: sub.id,
      status: "ACTIVE",
      type: "REGULAR",
      startsAt: new Date(Date.now() - 60000),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const conn = await db.adsConnection.create({
    data: {
      userId: owner.id,
      platform: "GOOGLE",
      externalIdentity: "test",
      credentials: encryptCredentials(
        JSON.stringify({ accessToken: "test", refreshToken: "test" }),
        "ab".repeat(32),
      ),
    },
  });
  const a = adflowRouter.createCaller(context(owner.id)),
    b = adflowRouter.createCaller(context(other.id));
  await t.test(
    "unauthenticated and cross-user access are rejected",
    async () => {
      await assert.rejects(
        () => adflowRouter.createCaller(context()).accounts({ limit: 20 }),
        { code: "UNAUTHORIZED" },
      );
      await assert.rejects(() => b.discover({ id: conn.id }), {
        code: "NOT_FOUND",
      });
      await assert.rejects(
        () =>
          a.bind({
            connectionId: conn.id,
            externalId: "bad",
            industry: "general",
            region: "GLOBAL",
            objective: "CONVERSIONS",
          }),
        { code: "BAD_REQUEST" },
      );
    },
  );
  await t.test(
    "OAuth state is bound to a session, expires and cannot be replayed",
    async () => {
      const start = await service.beginAuthorization(owner.id, "GOOGLE");
      const state = new URL(start.url).searchParams.get("state")!;
      await assert.rejects(() =>
        service.finishAuthorization(other.id, "GOOGLE", state, "code"),
      );
      assert.ok(await redis.get(`adflow:oauth:${state}`));
      await service.finishAuthorization(owner.id, "GOOGLE", state, "code");
      await assert.rejects(() =>
        service.finishAuthorization(owner.id, "GOOGLE", state, "code"),
      );
      assert.equal(await redis.get(`adflow:oauth:${state}`), null);
    },
  );
  await t.test(
    "ordinary users cannot manufacture subscription entitlement",
    async () => {
      const member = membershipRouter.createCaller(context(owner.id));
      await assert.rejects(
        () =>
          member.createSubscription({
            userId: owner.id,
            planId: "fake",
            planSnapshot: { metadata: { adflow: true, accountLimit: 20 } },
            gateway: "STRIPE",
          }),
        { code: "FORBIDDEN" },
      );
      await assert.rejects(
        () =>
          member.createSubscriptionCycle({
            subscriptionId: sub.id,
            type: "REGULAR",
            startsAt: new Date(),
            expiresAt: new Date(Date.now() + 999999999),
          }),
        { code: "FORBIDDEN" },
      );
    },
  );
  await t.test(
    "concurrent account binding cannot exceed one paid slot",
    async () => {
      const results = await Promise.allSettled(
        ["11", "22"].map((externalId) =>
          service.bindAccount(owner.id, {
            connectionId: conn.id,
            externalId,
            industry: "general",
            region: "GLOBAL",
            objective: "CONVERSIONS",
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await entitlement(owner.id)).used, 1);
    },
  );
  const account = await db.adsAccount.findFirstOrThrow({
    where: { userId: owner.id },
  });
  const run = await db.adsSyncRun.findFirstOrThrow({
    where: { accountId: account.id },
  });
  await t.test(
    "credentials never appear in list APIs and foreign users cannot delete data",
    async () => {
      const list = await a.connections({ limit: 20 });
      assert.equal(JSON.stringify(list).includes("credentials"), false);
      await assert.rejects(() => b.deleteData({ id: account.id }), {
        code: "NOT_FOUND",
      });
      assert.equal((await b.accounts({ limit: 20 })).items.length, 0);
    },
  );
  await t.test(
    "duplicate sync requests return the same durable outbox job",
    async () => {
      const again = await service.requestSync(owner.id, account.id);
      assert.equal(again.id, run.id);
    },
  );
  await t.test(
    "complete snapshots generate one report and preserve accepted suggestions on replay",
    async () => {
      await processAdflowJob(job("sync", run.id));
      const snapshot = await db.adsSyncRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      assert.equal(snapshot.status, "SUCCEEDED");
      assert.ok(snapshot.snapshotHash);
      await processAdflowJob(job("sync", run.id));
      const report = await requestDiagnosis(owner.id, account.id);
      const replay = await requestDiagnosis(owner.id, account.id);
      assert.equal(replay.id, report.id);
      await processAdflowJob(job("diagnose", report.id));
      const result = await a.report({ id: report.id });
      assert.equal(result.status, "SUCCEEDED");
      assert.equal(result.recommendations.length, 1);
      await assert.rejects(() => b.report({ id: report.id }), {
        code: "NOT_FOUND",
      });
      const recommendation = result.recommendations[0]!;
      await assert.rejects(
        () => b.recommendation({ id: recommendation.id, status: "ACCEPTED" }),
        { code: "NOT_FOUND" },
      );
      await a.recommendation({ id: recommendation.id, status: "ACCEPTED" });
      await processAdflowJob(job("diagnose", report.id));
      assert.equal(
        (await a.report({ id: report.id })).recommendations[0]?.status,
        "ACCEPTED",
      );
    },
  );
  await t.test("AI evidence outside the snapshot fails safely and retry can recover",async()=>{
    const second=await requestDiagnosis(owner.id,account.id,"en");
    invalidEvidence=true;
    await assert.rejects(()=>processAdflowJob(job("diagnose",second.id)),{message:"PROCESSING_FAILED"});
    assert.equal((await db.adsReport.findUniqueOrThrow({where:{id:second.id}})).status,"FAILED");
    assert.equal(await db.adsRecommendation.count({where:{reportId:second.id}}),0);
    invalidEvidence=false;
    await processAdflowJob(job("diagnose",second.id));
    assert.equal((await db.adsReport.findUniqueOrThrow({where:{id:second.id}})).status,"SUCCEEDED");
  });
  await t.test("provider authorization errors persist a safe failure and require reauthorization",async()=>{
    const retry=await service.requestSync(owner.id,account.id);
    failProviderAuthorization=true;
    await assert.rejects(()=>processAdflowJob(job("sync",retry.id)),{message:"REAUTH_REQUIRED"});
    assert.equal((await db.adsSyncRun.findUniqueOrThrow({where:{id:retry.id}})).errorCode,"REAUTH_REQUIRED");
    assert.equal((await db.adsConnection.findUniqueOrThrow({where:{id:conn.id}})).status,"REAUTH_REQUIRED");
    failProviderAuthorization=false;
    await db.adsConnection.update({where:{id:conn.id},data:{status:"ACTIVE"}});
  });
  await t.test(
    "unmatched benchmarks remain empty and are not fabricated",
    async () => {
      assert.deepEqual(
        await compareBenchmarks({
          platform: "META",
          industry: "test",
          region: "US",
          objective: "LEADS",
          currency: "EUR",
          attribution: "none",
          endDate: "2026-07-30",
        }),
        [],
      );
    },
  );
  await t.test(
    "revocation cancels queued work, removes stored credentials and frees quota",
    async () => {
      const queued = await service.requestSync(owner.id, account.id);
      await service.revokeConnection(owner.id, conn.id);
      assert.equal(
        (await db.adsConnection.findUniqueOrThrow({ where: { id: conn.id } }))
          .credentials,
        "",
      );
      assert.equal((await entitlement(owner.id)).used, 0);
      await processAdflowJob(job("sync", queued.id));
      assert.equal(
        (await db.adsSyncRun.findUniqueOrThrow({ where: { id: queued.id } }))
          .status,
        "CANCELLED",
      );
    },
  );
  await t.test(
    "scheduled downgrades require a paid new cycle and apply only once",
    async () => {
      const { scheduleDowngrade, reconcilePlanChanges } =
        await import("@/modules/ad-entitlements/server/plan-change");
      await db.userSubscription.update({
        where: { id: sub.id },
        data: {
          gateway: "STRIPE",
          gatewaySubscriptionId: "sub-test",
          planSnapshot: { metadata: { adflow: true, accountLimit: 5 } },
        },
      });
      const plan = await db.subscriptionPlan.create({
        data: {
          name: "Test plan",
          type: "STARTER",
          status: "ACTIVE",
          interval: "MONTH",
        },
      });
      testPlans.push(plan.id);
      const product = await db.product.create({
        data: {
          name: "Test lower plan",
          price: 1000,
          currency: "usd",
          type: "SUBSCRIPTION",
          status: "ACTIVE",
          isAvailable: true,
          metadata: { adflow: true, accountLimit: 1 },
          productSubscription: { create: { planId: plan.id } },
        },
      });
      testProducts.push(product.id);
      await assert.rejects(() => scheduleDowngrade(other.id, product.id));
      await scheduleDowngrade(owner.id, product.id);
      await scheduleDowngrade(owner.id, product.id);
      assert.equal(scheduleUpdates, 1);
      assert.equal((await entitlement(owner.id)).limit, 5);
      await db.adsPlanChange.update({
        where: { subscriptionId: sub.id },
        data: { effectiveAt: new Date(Date.now() - 1000) },
      });
      remotePrice = "price-lower";
      invoicePaid = true;
      await reconcilePlanChanges();
      assert.equal((await entitlement(owner.id)).limit, 5);
      await db.userSubscriptionCycle.create({
        data: {
          subscriptionId: sub.id,
          sequenceNumber: 2,
          status: "ACTIVE",
          type: "REGULAR",
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await reconcilePlanChanges();
      await reconcilePlanChanges();
      assert.equal((await entitlement(owner.id)).limit, 1);
      assert.equal(
        (
          await db.adsPlanChange.findUniqueOrThrow({
            where: { subscriptionId: sub.id },
          })
        ).status,
        "SUCCEEDED",
      );
    },
  );
  await t.test(
    "expired billing cycles no longer grant account capacity",
    async () => {
      await db.userSubscriptionCycle.updateMany({
        where: { subscriptionId: sub.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await entitlement(owner.id)).limit, 0);
    },
  );
});
