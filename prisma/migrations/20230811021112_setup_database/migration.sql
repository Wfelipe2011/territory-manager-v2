-- CreateTable
CREATE TABLE "address" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "type" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "legend" TEXT,
    "order" INTEGER,
    "dont_visit" BOOLEAN NOT NULL DEFAULT false,
    "block_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "phone" TEXT,
    "territory_id" INTEGER NOT NULL,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "house_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "congregation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "congregation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "congregation_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,

    CONSTRAINT "territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_block" (
    "id" SERIAL NOT NULL,
    "block_id" INTEGER NOT NULL,
    "territory_id" INTEGER NOT NULL,
    "signature_id" INTEGER,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "territory_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_overseer" (
    "id" SERIAL NOT NULL,
    "territory_id" INTEGER NOT NULL,
    "overseer" TEXT NOT NULL,
    "initial_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiration_date" TIMESTAMP(3),
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "signature_id" INTEGER,

    CONSTRAINT "territory_overseer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round" (
    "id" SERIAL NOT NULL,
    "house_id" INTEGER NOT NULL,
    "territory_id" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "congregation_id" INTEGER NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "token" TEXT NOT NULL,

    CONSTRAINT "signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "address_id_key" ON "address"("id");

-- CreateIndex
CREATE UNIQUE INDEX "type_id_key" ON "type"("id");

-- CreateIndex
CREATE UNIQUE INDEX "block_id_key" ON "block"("id");

-- CreateIndex
CREATE UNIQUE INDEX "house_id_key" ON "house"("id");

-- CreateIndex
CREATE UNIQUE INDEX "congregation_id_key" ON "congregation"("id");

-- CreateIndex
CREATE UNIQUE INDEX "territory_id_key" ON "territory"("id");

-- CreateIndex
CREATE UNIQUE INDEX "territory_block_id_key" ON "territory_block"("id");

-- CreateIndex
CREATE UNIQUE INDEX "territory_block_territory_id_block_id_key" ON "territory_block"("territory_id", "block_id");

-- CreateIndex
CREATE UNIQUE INDEX "territory_overseer_id_key" ON "territory_overseer"("id");

-- CreateIndex
CREATE UNIQUE INDEX "round_id_key" ON "round"("id");

-- CreateIndex
CREATE UNIQUE INDEX "round_house_id_key" ON "round"("house_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_id_key" ON "user"("id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "signature_id_key" ON "signature"("id");

-- CreateIndex
CREATE UNIQUE INDEX "signature_key_key" ON "signature"("key");

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "type" ADD CONSTRAINT "type_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block" ADD CONSTRAINT "block_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house" ADD CONSTRAINT "house_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory" ADD CONSTRAINT "territory_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block" ADD CONSTRAINT "territory_block_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block" ADD CONSTRAINT "territory_block_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block" ADD CONSTRAINT "territory_block_signature_id_fkey" FOREIGN KEY ("signature_id") REFERENCES "signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_block" ADD CONSTRAINT "territory_block_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_overseer" ADD CONSTRAINT "territory_overseer_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_overseer" ADD CONSTRAINT "territory_overseer_signature_id_fkey" FOREIGN KEY ("signature_id") REFERENCES "signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round" ADD CONSTRAINT "round_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "house"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round" ADD CONSTRAINT "round_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round" ADD CONSTRAINT "round_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_congregation_id_fkey" FOREIGN KEY ("congregation_id") REFERENCES "congregation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
