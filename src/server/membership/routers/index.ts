import { protectedProcedure, adminProcedure, createTRPCRouter } from '@/server/api/trpc'
import { CreateSubscriptionParamsSchema, CreateSubscriptionCycleParamsSchema, GetSubscriptionStatusParamsSchema } from '../schemas'
import { createSubscription } from '../services/create-subscription'
import { createSubscriptionCycle } from '../services/create-subscription-cycle'
import { getSubscriptionStatus } from '../services/get-subscription-status'
import { earlyConvertTrial } from '../services/early-convert-trial'

export const membershipRouter = createTRPCRouter({
  createSubscription: adminProcedure.input(CreateSubscriptionParamsSchema).mutation(({ input }) => createSubscription(input)),
  createSubscriptionCycle: adminProcedure.input(CreateSubscriptionCycleParamsSchema).mutation(({ input }) => createSubscriptionCycle(input)),
  getSubscriptionStatus: protectedProcedure.input(GetSubscriptionStatusParamsSchema).query(({ ctx }) => getSubscriptionStatus({ userId: ctx.session.user.id })),
  earlyConvertTrial: protectedProcedure.mutation(async ({ ctx }) =>
    earlyConvertTrial({ userId: ctx.session.user.id })
  ),
})


