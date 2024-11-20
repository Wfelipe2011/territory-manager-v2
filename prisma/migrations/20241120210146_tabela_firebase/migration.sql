-- CreateTable
CREATE TABLE "firebase" (
    "id" SERIAL NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "firebase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firebase_id_key" ON "firebase"("id");
