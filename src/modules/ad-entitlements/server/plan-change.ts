import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { getStripe } from "@/server/order/services/stripe/client";
import { planMetadata, entitlement } from "./service";
import { z } from "zod";
import { getProduct } from "@/server/product/services/get";
import type { Prisma } from "@prisma/client";

export async function scheduleDowngrade(userId: string, productId: string) {
  const current = await entitlement(userId);
  const product = await db.product.findFirst({
    where: {
      id: productId,
      type: "SUBSCRIPTION",
      status: "ACTIVE",
      isAvailable: true,
      deletedAt: null,
    },
    include: { productSubscription: true },
  });
  const meta = planMetadata.safeParse(product?.metadata);
  if (
    !product ||
    !meta.success ||
    !product.productSubscription ||
    product.price <= 0 ||
    meta.data.accountLimit >= current.limit
  )
    throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOWNGRADE" });
  const sub = await db.userSubscription.findFirst({
    where: { userId, status: "ACTIVE", gateway: "STRIPE", deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (
    !sub?.gatewaySubscriptionId ||
    !z.object({ metadata: planMetadata }).safeParse(sub.planSnapshot).success
  )
    throw new TRPCError({ code: "PRECONDITION_FAILED" });
  const stripe = getStripe();
  const remote = await stripe.subscriptions.retrieve(sub.gatewaySubscriptionId);
  const item = remote.items.data[0];
  if (
    !item ||
    remote.items.data.length !== 1 ||
    remote.status !== "active" ||
    remote.cancel_at_period_end ||
    item.price.currency !== product.currency.toLowerCase() ||
    item.price.recurring?.interval !== "month" ||
    !item.price.unit_amount ||
    product.price >= item.price.unit_amount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SUBSCRIPTION_CHANGE_UNAVAILABLE",
    });
  const effectiveAt = new Date(item.current_period_end * 1000);
  const change = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const prior = await tx.adsPlanChange.findUnique({
      where: { subscriptionId: sub.id },
    });
    if (
      prior &&
      ["QUEUED", "RUNNING"].includes(prior.status) &&
      prior.targetProductId !== productId
    )
      throw new TRPCError({ code: "CONFLICT", message: "PLAN_CHANGE_PENDING" });
    if (prior && ["QUEUED", "RUNNING"].includes(prior.status)) return prior;
    return tx.adsPlanChange.upsert({
      where: { subscriptionId: sub.id },
      create: {
        userId,
        subscriptionId: sub.id,
        targetProductId: productId,
        targetLimit: meta.data.accountLimit,
        effectiveAt,
      },
      update: {
        targetProductId: productId,
        targetLimit: meta.data.accountLimit,
        effectiveAt,
        status: "QUEUED",
        scheduleId: null,
        stripePriceId: null,
      },
    });
  });
  if (change.status === "RUNNING") return { effectiveAt: change.effectiveAt };
  const key = `adflow-downgrade-${change.id}-${item.current_period_end}-${productId}`;
  // The provider wrapper owns Stripe access. These calls schedule a future lower-priced phase.
  const price = await stripe.prices.create(
    {
      currency: product.currency,
      unit_amount: product.price,
      recurring: { interval: "month" },
      product_data: { name: product.name },
      metadata: { adflowProductId: product.id },
    },
    { idempotencyKey: `${key}-price` },
  );
  const schedule = change.scheduleId
    ? await stripe.subscriptionSchedules.retrieve(change.scheduleId)
    : await stripe.subscriptionSchedules.create(
        { from_subscription: remote.id },
        { idempotencyKey: `${key}-schedule` },
      );
  if (
    schedule.metadata?.adflowChangeId &&
    schedule.metadata.adflowChangeId !== change.id
  )
    throw new TRPCError({ code: "CONFLICT", message: "PLAN_CHANGE_PENDING" });
  await db.adsPlanChange.update({
    where: { id: change.id },
    data: { scheduleId: schedule.id, stripePriceId: price.id },
  });
  await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      metadata: { adflowChangeId: change.id },
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          items: [{ price: item.price.id, quantity: item.quantity ?? 1 }],
          start_date: item.current_period_start,
          end_date: item.current_period_end,
          proration_behavior: "none",
        },
        {
          items: [{ price: price.id, quantity: 1 }],
          start_date: item.current_period_end,
          duration: { interval: "month", interval_count: 1 },
          proration_behavior: "none",
        },
      ],
    },
    { idempotencyKey: `${key}-phases` },
  );
  await db.adsPlanChange.update({
    where: { id: change.id },
    data: {
      scheduleId: schedule.id,
      stripePriceId: price.id,
      status: "RUNNING",
    },
  });
  return { effectiveAt };
}
export async function pendingPlanChange(userId: string) {
  return db.adsPlanChange.findFirst({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, targetLimit: true, effectiveAt: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}
export async function reconcilePlanChanges() {
  const changes = await db.adsPlanChange.findMany({
    where: { status: "RUNNING", effectiveAt: { lte: new Date() } },
    take: 50,
    orderBy: { updatedAt: "asc" },
  });
  for (const change of changes) {
    const sub = await db.userSubscription.findUnique({
      where: { id: change.subscriptionId },
    });
    if (!sub?.gatewaySubscriptionId) continue;
    const cycle = await db.userSubscriptionCycle.findFirst({
      where: {
        subscriptionId: sub.id,
        status: "ACTIVE",
        startsAt: { gte: change.effectiveAt },
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    // A signed, processed renewal webhook must have delivered the new paid cycle first.
    if (!cycle) continue;
    const stripe = getStripe();
    const remote = await stripe.subscriptions.retrieve(
      sub.gatewaySubscriptionId,
      { expand: ["latest_invoice"] },
    );
    const invoice = remote.latest_invoice;
    if (
      remote.status !== "active" ||
      remote.items.data[0]?.price.id !== change.stripePriceId ||
      !invoice ||
      typeof invoice === "string" ||
      invoice.status !== "paid"
    )
      continue;
    const product = await getProduct({ productId: change.targetProductId });
    product.metadata = { adflow: true, accountLimit: change.targetLimit };
    if (!product.productSubscription) continue;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${change.userId}))`;
      const claimed = await tx.adsPlanChange.updateMany({
        where: { id: change.id, status: "RUNNING" },
        data: { status: "SUCCEEDED" },
      });
      if (!claimed.count) return;
      // Same framework subscription, new webhook-confirmed plan snapshot. No direct entitlement grants.
      await tx.userSubscription.update({
        where: { id: sub.id },
        data: {
          planId: product.productSubscription!.plan.id,
          planSnapshot: JSON.parse(
            JSON.stringify(product),
          ) as Prisma.InputJsonValue,
        },
      });
    });
  }
}
