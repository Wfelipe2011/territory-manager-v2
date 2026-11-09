import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./utils/app-helper";
import { cleanDatabase } from "./utils/db-cleaner";
import { PrismaService } from "../src/infra/prisma/prisma.service";
import { requestFixture } from "./utils/request-fixture";

describe("Atualização da proposta de ordenação", () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await cleanDatabase(app.get(PrismaService)); });
  async function fixture() {
    const f = await requestFixture(app), tree = await f.tree();
    await f.review(Object.values(tree)).expect(201);
    const b = await f.create("street", { name: "Rua B" }, { blockId: tree.block.targetId });
    const c = await f.create("street", { name: "Rua C" }, { blockId: tree.block.targetId });
    await f.review([b, c]).expect(201);
    const url = `/v1/change-requests/street-order/${f.territory.id}/${tree.block.targetId}`;
    const current = (await request(f.server).get(url).set(f.auth(f.leader))).body;
    return { f, tree, url, current, ordered: [...current].reverse().map((e: any) => e.id) };
  }
  it("atualiza a mesma proposta com versão, recupera a prévia e exige a versão atual na aprovação", async () => {
    const { f, tree, url, current, ordered } = await fixture();
    const first = (await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered }).expect(201)).body;
    const next = [ordered[1], ordered[0], ordered[2]];
    const updated = (await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered: next, requestId: first.id, version: first.version }).expect(201)).body;
    expect(updated).toMatchObject({ id: first.id, version: first.version + 1 });
    expect(await f.prisma.change_request.count({ where: { entity: "block", action: "update", status: "pending" } })).toBe(1);
    expect(updated.history.at(-1).event).toBe("order_updated");
    const state = (await request(f.server).get(`${url}/state`).set(f.auth(f.leader)).expect(200)).body;
    expect(state.pending).toMatchObject({ id: first.id, version: updated.version, ordered: next, editable: true, conflict: false });
    expect((await f.snapshot(tree.block.targetId)).data.streets.map((s: any) => s.id)).toEqual(current.map((e: any) => e.id));
    await f.review([first]).expect(409);
    await f.review([updated]).expect(201);
    expect((await f.snapshot(tree.block.targetId)).data.streets.map((s: any) => s.id)).toEqual(next);
    await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered, requestId: first.id, version: updated.version }).expect(409);
    expect((await request(f.server).get(`${url}/state`).set(f.auth(f.leader))).body.pending).toBeNull();
  });
  it("recusa atualização por outro link ou com versão antiga e mantém a ordem ao rejeitar", async () => {
    const { f, url, current, ordered } = await fixture();
    const first = (await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered }).expect(201)).body;
    const link = (await request(f.server).post(`/v1/territories/${f.territory.id}/signature`).set(f.auth(f.admin)).send({ overseer: "Outro dirigente", round: 1, expirationTime: "2099-12-31", canEditStructure: true }).expect(201)).body;
    const other = (await request(f.server).get(`/v1/signature/${link.signature}`)).body.token;
    const state = (await request(f.server).get(`${url}/state`).set(f.auth(other)).expect(200)).body;
    expect(state.pending).toMatchObject({ editable: false, ordered: null });
    await request(f.server).post(url).set(f.auth(other)).send({ expected: current, ordered, requestId: first.id, version: first.version }).expect(409);
    await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered, requestId: first.id, version: 999 }).expect(409);
    await f.review([first], "reject").expect(201);
    expect((await request(f.server).get(url).set(f.auth(f.admin))).body).toEqual(current);
  });
  it("recusa proposta cuja base foi alterada e permite ordenar sob quadra provisória", async () => {
    const { f, tree, url, current, ordered } = await fixture();
    const first = (await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered }).expect(201)).body;
    await request(f.server).post(url).set(f.auth(f.admin)).send({ expected: current, ordered }).expect(201);
    const now = (await request(f.server).get(url).set(f.auth(f.admin))).body;
    await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: now, ordered, requestId: first.id, version: first.version }).expect(409);
    await f.review([first]).expect(409);
    const pendingBlock = await f.create("block", { name: "Quadra provisória" });
    await f.create("street", { name: "Rua X" }, { blockId: pendingBlock.targetId });
    await f.create("street", { name: "Rua Y" }, { blockId: pendingBlock.targetId });
    const pendingUrl = `/v1/change-requests/street-order/${f.territory.id}/${pendingBlock.targetId}`;
    const rows = (await request(f.server).get(pendingUrl).set(f.auth(f.leader))).body;
    const proposal = (await request(f.server).post(pendingUrl).set(f.auth(f.leader)).send({ expected: rows, ordered: rows.map((e: any) => e.id).reverse() }).expect(201)).body;
    expect(proposal.parentRequestId).toBe(pendingBlock.id);
    expect(proposal.targetId).toBeNull();
    expect(await f.prisma.house.count({ where: { id: tree.house.targetId } })).toBe(1);
  });
  it("serializa dois arrastes concorrentes sem perder a versão da proposta", async () => {
    const { f, url, current, ordered } = await fixture();
    const first = (await request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered }).expect(201)).body;
    const results = await Promise.all([
      request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered: [ordered[1], ordered[0], ordered[2]], requestId: first.id, version: first.version }),
      request(f.server).post(url).set(f.auth(f.leader)).send({ expected: current, ordered: [ordered[0], ordered[2], ordered[1]], requestId: first.id, version: first.version }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const saved = await f.prisma.change_request.findUniqueOrThrow({ where: { id: first.id } });
    expect(saved.version).toBe(first.version + 1);
    expect(saved.history).toHaveLength(2);
  });

});
