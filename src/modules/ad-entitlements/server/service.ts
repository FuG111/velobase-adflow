import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import type { Prisma } from "@prisma/client";
export const planMetadata = z.object({
  adflow: z.literal(true),
  accountLimit: z.union([z.literal(1), z.literal(5), z.literal(20)]),
});
export async function entitlement(
  userId: string,
  tx: Prisma.TransactionClient = db,
) {
  const now = new Date();
  const subscriptions = await tx.userSubscription.findMany({
    where: {
      userId,
      status: "ACTIVE",
      deletedAt: null,
      cycles: {
        some: {
          status: "ACTIVE",
          startsAt: { lte: now },
          expiresAt: { gt: now },
          deletedAt: null,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  let limit = 0;
  // Read webhook-fulfilled immutable product snapshots; newer active subscription wins.
  for (const sub of subscriptions) {
    const parsed = z
      .object({ metadata: planMetadata })
      .safeParse(sub.planSnapshot);
    if (parsed.success) {
      limit = parsed.data.metadata.accountLimit;
      break;
    }
  }
  const used = await tx.adsAccount.count({
    where: { userId, status: "BOUND" },
  });
  return { limit, used, overLimit: used > limit };
}
export async function requireEntitlement(
  userId: string,
  tx: Prisma.TransactionClient = db,
) {
  const result = await entitlement(userId, tx);
  if (!result.limit || result.overLimit)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "ACCOUNT_ENTITLEMENT_REQUIRED",
    });
  return result;
}
export async function plans() {
  const products = await db.product.findMany({
    where: {
      type: "SUBSCRIPTION",
      status: "ACTIVE",
      isAvailable: true,
      deletedAt: null,
      metadata: { path: ["adflow"], equals: true },
    },
    orderBy: { sortOrder: "asc" },
    take: 20,
  });
  return products.flatMap((product) => {
    const meta = planMetadata.safeParse(product.metadata);
    return meta.success && product.price > 0
      ? [
          {
            id: product.id,
            name: product.name,
            amount: product.price,
            currency: product.currency,
            limit: meta.data.accountLimit,
          },
        ]
      : [];
  });
}
