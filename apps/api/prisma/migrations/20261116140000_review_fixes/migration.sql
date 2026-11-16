-- AlterEnum
ALTER TYPE "EnvelopeStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "approvedShareIds" TEXT[],
ADD COLUMN     "confirmCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "refundCheckedAt" TIMESTAMP(3);

