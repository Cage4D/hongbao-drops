-- CreateEnum
CREATE TYPE "Network" AS ENUM ('CHIPNET', 'MAINNET');

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('EQUAL', 'LUCKY', 'QUIZ');

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('PENDING_FUNDING', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ShareStatus" AS ENUM ('AVAILABLE', 'HELD', 'RESERVED', 'CLAIMED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('APPROVED', 'BROADCAST', 'CONFIRMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('FUND', 'CLAIMED', 'REFUNDED', 'FEE');

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "adminToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "refundLockingBytecode" TEXT NOT NULL,
    "linkPk" TEXT NOT NULL,
    "gatePk" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "contractLockingBytecode" TEXT NOT NULL,
    "expiry" INTEGER NOT NULL,
    "maxFee" INTEGER NOT NULL,
    "mode" "Mode" NOT NULL,
    "quizQuestion" TEXT,
    "quizAnswerHashes" TEXT[],
    "quizSalt" TEXT,
    "withStamps" BOOLEAN NOT NULL DEFAULT true,
    "stampCategory" TEXT,
    "bcmrRegistry" TEXT,
    "bcmrHash" TEXT,
    "totalSats" BIGINT NOT NULL,
    "shareCount" INTEGER NOT NULL,
    "message" TEXT,
    "theme" TEXT NOT NULL,
    "campaignId" TEXT,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "sponsorFeeSats" BIGINT NOT NULL DEFAULT 0,
    "parentEnvelopeId" TEXT,
    "fundingTxid" TEXT,
    "fundedAt" TIMESTAMP(3),
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'PENDING_FUNDING',
    "ctaClicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "outpointTxid" TEXT NOT NULL,
    "outpointIndex" INTEGER NOT NULL,
    "sats" BIGINT NOT NULL,
    "nftCommitment" TEXT,
    "status" "ShareStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reservedUntil" TIMESTAMP(3),
    "holdToken" TEXT,
    "spendTxid" TEXT,

    CONSTRAINT "Share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "shareId" TEXT,
    "recipientAddress" TEXT NOT NULL,
    "walletFingerprint" TEXT,
    "ipHash" TEXT,
    "isNewWallet" BOOLEAN,
    "activatedWithin7d" BOOLEAN,
    "suspectedFarm" BOOLEAN NOT NULL DEFAULT false,
    "farmReasons" TEXT[],
    "claimTxid" TEXT,
    "amountSats" BIGINT,
    "status" "ClaimStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "sats" BIGINT NOT NULL,
    "usd" DECIMAL(12,4) NOT NULL,
    "txid" TEXT NOT NULL,
    "envelopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sponsor_adminToken_key" ON "Sponsor"("adminToken");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_seq_key" ON "Envelope"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_slug_key" ON "Envelope"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_fundingTxid_key" ON "Envelope"("fundingTxid");

-- CreateIndex
CREATE INDEX "Envelope_network_status_idx" ON "Envelope"("network", "status");

-- CreateIndex
CREATE INDEX "Envelope_campaignId_idx" ON "Envelope"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Share_holdToken_key" ON "Share"("holdToken");

-- CreateIndex
CREATE INDEX "Share_envelopeId_status_idx" ON "Share"("envelopeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Share_outpointTxid_outpointIndex_key" ON "Share"("outpointTxid", "outpointIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Share_envelopeId_index_key" ON "Share"("envelopeId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_shareId_key" ON "Claim"("shareId");

-- CreateIndex
CREATE INDEX "Claim_envelopeId_createdAt_idx" ON "Claim"("envelopeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_envelopeId_recipientAddress_key" ON "Claim"("envelopeId", "recipientAddress");

-- CreateIndex
CREATE INDEX "LedgerEntry_kind_idx" ON "LedgerEntry"("kind");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_parentEnvelopeId_fkey" FOREIGN KEY ("parentEnvelopeId") REFERENCES "Envelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Share" ADD CONSTRAINT "Share_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
