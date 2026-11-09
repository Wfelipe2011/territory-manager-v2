import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./utils/app-helper";
import { cleanDatabase } from "./utils/db-cleaner";
import { PrismaService } from "../src/infra/prisma/prisma.service";
import { requestFixture } from "./utils/request-fixture";

describe("Edição da quadra com ordem das ruas", () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); });

  async function fixture() {
    const f = await requestFixture(app), tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    const second = await f.create("street", { name: "Rua B" }, { blockId: tree.block.targetId });
    await f.review([second]).expect(201);
    const orderUrl = `/v1/change-requests/street-order/${f.territory.id}/${tree.block.targetId}`;
    const blockUrl = `/v2/territories/${f.territory.id}/blocks`;
    const block = (await request(f.server).get(`${blockUrl}/${tree.block.targetId}`).set(f.auth(f.admin)).expect(200)).body;
    const current = (await request(f.server).get(orderUrl).set(f.auth(f.admin)).expect(200)).body;
    const body = { id: block.id, name: block.name, expectedBlockName: block.name, expectedAddresses: block.addresses, saveStreetOrder: true, expectedStreetOrder: current, addresses: block.addresses.map((a: any) => ({ ...a })).reverse() };
    return { f, tree, block, second, orderUrl, blockUrl, current, body };
  }
  it("salva correção e ordem atomicamente e preserva casas, marcações e ruas provisórias", async () => {
    const { f, tree, body, blockUrl } = await fixture();
    const pending = await f.create("street", { name: "Rua A provisória" }, { blockId: tree.block.targetId });
    body.expectedStreetOrder = (await request(f.server).get(`/v1/change-requests/street-order/${f.territory.id}/${body.id}`).set(f.auth(f.admin))).body;
    const mappingId = body.addresses[0].mappingId;
    body.addresses[0].street = "Rua corrigida";
    const round = await f.prisma.round.findFirstOrThrow({ where: { houseId: tree.house.targetId } });
    await f.prisma.round.update({ where: { id: round.id }, data: { completed: true } });
    const response = await request(f.server).post(blockUrl).set(f.auth(f.admin)).send(body).expect(201);
    expect(response.body.addresses.map((a: any) => a.mappingId)).toEqual(body.addresses.map((a: any) => a.mappingId));
    expect(response.body.addresses[0]).toMatchObject({ mappingId, street: "Rua corrigida" });
    expect(await f.prisma.house.findUnique({ where: { id: tree.house.targetId } })).toBeTruthy();
    expect(await f.prisma.round.findUnique({ where: { id: round.id } })).toMatchObject({ completed: true });
    expect(await f.prisma.territory_block_address.findUnique({ where: { id: pending.targetId } })).toMatchObject({ registrationStatus: "pending" });
    const all = (await f.snapshot(body.id)).data.streets;
    expect(all[0].id).toBe(pending.addressId);
  });
  it("recusa estado antigo, vínculos estrangeiros e duplicados sem salvar nomes parcialmente", async () => {
    const { f, tree, body, blockUrl, current, orderUrl } = await fixture();
    const originalName = body.name;
    body.name = "Não salvar";
    const invalid = { ...body, addresses: body.addresses.map((a: any, i: number) => i ? a : { ...a, mappingId: 2147483647 }) };
    await request(f.server).post(blockUrl).set(f.auth(f.admin)).send(invalid).expect(400);
    const duplicate = { ...body, addresses: body.addresses.map((a: any) => ({ ...a, street: "Duplicada" })) };
    await request(f.server).post(blockUrl).set(f.auth(f.admin)).send(duplicate).expect(409);
    await request(f.server).post(orderUrl).set(f.auth(f.admin)).send({ expected: current, ordered: [...current].reverse().map((e: any) => e.id) }).expect(201);
    await request(f.server).post(blockUrl).set(f.auth(f.admin)).send(body).expect(409);
    expect(await f.prisma.block.findUnique({ where: { id: tree.block.targetId } })).toMatchObject({ name: originalName });
  });
  it("inclui uma rua na posição escolhida e remove outra sem perder a associação das restantes", async () => {
    const { f, tree, body, blockUrl } = await fixture();
    const keep = body.addresses.find((a: any) => a.id === tree.street.addressId);
    body.addresses = [{ street: "Rua adicionada", zipCode: "" }, keep];
    const response = await request(f.server).post(blockUrl).set(f.auth(f.admin)).send(body).expect(201);
    expect(response.body.addresses.map((a: any) => a.street)).toEqual(["Rua adicionada", keep.street]);
    expect(await f.prisma.house.findUnique({ where: { id: tree.house.targetId } })).toMatchObject({ territoryBlockAddressId: tree.street.targetId });
  });
});
