/** Create draft AdFlow products. Existing prices/availability are never overwritten. */
import "dotenv/config";
import { db } from "@/server/db";
const tiers = [
  {
    key: "starter",
    name: "AdFlow Starter",
    limit: 1,
    type: "STARTER" as const,
  },
  { key: "growth", name: "AdFlow Growth", limit: 5, type: "PLUS" as const },
  { key: "scale", name: "AdFlow Scale", limit: 20, type: "PREMIUM" as const },
];
try {
  for (const [index, tier] of tiers.entries()) {
    const planId = `adflow-plan-${tier.key}`;
    const productId = `adflow-${tier.key}`;
    await db.$transaction(async (tx) => {
      await tx.subscriptionPlan.upsert({
        where: { id: planId },
        create: {
          id: planId,
          name: tier.name,
          type: tier.type,
          status: "ACTIVE",
          interval: "MONTH",
          creditsPerPeriod: 0,
          creditsPerMonth: 0,
        },
        update: {},
      });
      await tx.product.upsert({
        where: { id: productId },
        create: {
          id: productId,
          name: tier.name,
          type: "SUBSCRIPTION",
          interval: "month",
          currency: "usd",
          price: 0,
          status: "INACTIVE",
          isAvailable: false,
          sortOrder: index,
          metadata: { adflow: true, accountLimit: tier.limit },
          description: {
            en: `${tier.limit} advertising accounts`,
            zh: `${tier.limit} 个广告账户`,
          },
        },
        update: {},
      });
      await tx.productSubscription.upsert({
        where: { productId },
        create: { productId, planId },
        update: {},
      });
    });
  }
} finally {
  await db.$disconnect();
}
