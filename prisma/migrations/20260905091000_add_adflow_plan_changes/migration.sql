-- CreateTable
CREATE TABLE "AdsPlanChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "targetLimit" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "stripePriceId" TEXT,
    "scheduleId" TEXT,
    "status" "AdsRunStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsPlanChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdsPlanChange_subscriptionId_key" ON "AdsPlanChange"("subscriptionId");

-- CreateIndex
CREATE INDEX "AdsPlanChange_userId_status_idx" ON "AdsPlanChange"("userId", "status");
