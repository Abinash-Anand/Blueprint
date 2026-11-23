-- Google Calendar sync (docs/Google-Calendar-MVP-Plan.md): new tables only; nothing existing changes.
-- CreateTable
CREATE TABLE "GoogleConnection" (
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT NOT NULL,
    "calendarId" TEXT,
    "syncToken" TEXT,
    "startMinute" INTEGER NOT NULL DEFAULT 1080,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "googleEventId" TEXT,
    "etag" TEXT,
    "contentHash" TEXT,
    "startMinute" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarJob" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" TIMESTAMPTZ(3) NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "CalendarJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CalendarChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_googleEventId_idx" ON "CalendarEvent"("userId", "googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_userId_cityId_day_key" ON "CalendarEvent"("userId", "cityId", "day");

-- CreateIndex
CREATE INDEX "CalendarJob_runAt_idx" ON "CalendarJob"("runAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarJob_userId_kind_key" ON "CalendarJob"("userId", "kind");

-- CreateIndex
CREATE INDEX "CalendarChannel_expiresAt_idx" ON "CalendarChannel"("expiresAt");

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GoogleConnection"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarJob" ADD CONSTRAINT "CalendarJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GoogleConnection"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarChannel" ADD CONSTRAINT "CalendarChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "GoogleConnection"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

