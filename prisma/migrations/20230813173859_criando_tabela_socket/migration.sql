-- CreateTable
CREATE TABLE "Socket" (
    "id" SERIAL NOT NULL,
    "socketId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Socket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Socket_id_key" ON "Socket"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Socket_socketId_key" ON "Socket"("socketId");
