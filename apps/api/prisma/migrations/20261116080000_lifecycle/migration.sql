-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "activationCheckedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "sweptTo" TEXT[];

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedSats" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Event" (
    "id" BIGSERIAL NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_envelopeId_id_idx" ON "Event"("envelopeId", "id");

-- CreateIndex
CREATE INDEX "Envelope_parentEnvelopeId_idx" ON "Envelope"("parentEnvelopeId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

