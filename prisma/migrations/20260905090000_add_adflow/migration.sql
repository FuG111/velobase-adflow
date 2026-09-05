-- CreateEnum
CREATE TYPE "AdsPlatform" AS ENUM ('GOOGLE', 'META');

-- CreateEnum
CREATE TYPE "AdsConnectionStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AdsAccountStatus" AS ENUM ('BOUND', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AdsRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdsRecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AdsConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "AdsPlatform" NOT NULL,
    "externalIdentity" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" "AdsConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" "AdsPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "managerId" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "industry" TEXT NOT NULL DEFAULT 'general',
    "region" TEXT NOT NULL DEFAULT 'GLOBAL',
    "objective" TEXT NOT NULL DEFAULT 'CONVERSIONS',
    "status" "AdsAccountStatus" NOT NULL DEFAULT 'BOUND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsSyncRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "AdsRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "snapshot" JSONB,
    "snapshotHash" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL DEFAULT '1',
    "locale" TEXT NOT NULL DEFAULT 'zh',
    "status" "AdsRunStatus" NOT NULL DEFAULT 'QUEUED',
    "evidence" JSONB,
    "summary" TEXT,
    "model" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "status" "AdsRecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsBenchmark" (
    "id" TEXT NOT NULL,
    "platform" "AdsPlatform" NOT NULL,
    "industry" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "licenseNote" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdsConnection_userId_status_idx" ON "AdsConnection"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdsConnection_userId_platform_externalIdentity_key" ON "AdsConnection"("userId", "platform", "externalIdentity");

-- CreateIndex
CREATE INDEX "AdsAccount_userId_status_idx" ON "AdsAccount"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdsAccount_userId_platform_externalId_key" ON "AdsAccount"("userId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "AdsSyncRun_userId_accountId_createdAt_idx" ON "AdsSyncRun"("userId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AdsSyncRun_status_updatedAt_idx" ON "AdsSyncRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AdsReport_userId_accountId_createdAt_idx" ON "AdsReport"("userId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AdsReport_status_updatedAt_idx" ON "AdsReport"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdsReport_accountId_snapshotHash_ruleVersion_locale_key" ON "AdsReport"("accountId", "snapshotHash", "ruleVersion", "locale");

-- CreateIndex
CREATE INDEX "AdsRecommendation_userId_reportId_idx" ON "AdsRecommendation"("userId", "reportId");

-- CreateIndex
CREATE INDEX "AdsBenchmark_platform_industry_region_objective_published_idx" ON "AdsBenchmark"("platform", "industry", "region", "objective", "published");

-- AddForeignKey
ALTER TABLE "AdsAccount" ADD CONSTRAINT "AdsAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AdsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsSyncRun" ADD CONSTRAINT "AdsSyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsReport" ADD CONSTRAINT "AdsReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsReport" ADD CONSTRAINT "AdsReport_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "AdsSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsRecommendation" ADD CONSTRAINT "AdsRecommendation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AdsReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
