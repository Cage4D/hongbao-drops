-- DropIndex
DROP INDEX "Claim_envelopeId_recipientAddress_key";

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "recipientLockingBytecode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Share" ADD COLUMN     "holdFingerprint" TEXT;

-- CreateTable
CREATE TABLE "RateEvent" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateEvent_key_createdAt_idx" ON "RateEvent"("key", "createdAt");

-- CreateIndex
CREATE INDEX "Claim_envelopeId_walletFingerprint_idx" ON "Claim"("envelopeId", "walletFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_envelopeId_recipientLockingBytecode_key" ON "Claim"("envelopeId", "recipientLockingBytecode");

