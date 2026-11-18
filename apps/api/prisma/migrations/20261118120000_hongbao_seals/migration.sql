-- Rename the claimer NFTs from "stamps" to "Hongbao Seals" (BCH BLAZE 2026).
-- RENAME COLUMN keeps every row's data and is instant (catalog-only, no table rewrite).
-- The old names appear here only because this migration renames them.
ALTER TABLE "Envelope" RENAME COLUMN "withStamps" TO "withSeals";
ALTER TABLE "Envelope" RENAME COLUMN "stampCategory" TO "sealCategory";
