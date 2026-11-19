-- City creation intake (docs/AI-Voice-Design.md §10.4). Additive only: one enum value and one new table; no existing
-- row or column changes. Rollback: DROP TABLE "CityAttachment"; (the enum value is unused by older code and can stay).
-- AlterEnum
ALTER TYPE "AiOperation" ADD VALUE 'UNDERSTAND';

-- CreateTable
CREATE TABLE "CityAttachment" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "pages" INTEGER,
    "chars" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CityAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CityAttachment_cityId_idx" ON "CityAttachment"("cityId");

-- AddForeignKey
ALTER TABLE "CityAttachment" ADD CONSTRAINT "CityAttachment_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

