import 'dotenv/config';

const BASE = 'https://api-hmg.territory-manager.com.br';
const email = process.env.HMG_ADMIN_EMAIL;
const password = process.env.HMG_ADMIN_PASSWORD;
const round = Number(process.env.HMG_ROUND_NUMBER);

if (!email || !password || !round) throw new Error('env HMG_* ausente');

async function j<T>(url: string, token?: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function main() {
  const login = await j<{ token: string }>('/v1/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = login.token;

  const territories = await j<Array<{ territoryId: number; name?: string }>>(`/v1/territories?round=${round}`, token);
  console.log(`territories round=${round}: ${territories.length}`);

  for (const t of territories) {
    let best: { blockId: number; addressId: number; total: number; visitable: number } | null = null;
    try {
      const blocksData = await j<{
        blocks: Array<{ id: number; signature?: { key?: string | null } }>;
      }>(`/v1/territories/${t.territoryId}?round=${round}`, token);
      const signedBlocks = (blocksData.blocks || []).filter((b) => b.signature?.key);
      for (const b of signedBlocks.slice(0, 10)) {
          const addrData = await j<{ addresses: Array<{ id: number }> }>(
            `/v1/territories/${t.territoryId}/blocks/${b.id}?round=${round}`,
            token,
          );
        for (const a of (addrData.addresses || []).slice(0, 20)) {
          const houseData = await j<{ houses: Array<{ id: number; dontVisit?: boolean }> }>(
            `/v1/territories/${t.territoryId}/blocks/${b.id}/address/${a.id}?round=${round}`,
            token,
          );
          const visitable = (houseData.houses || []).filter((h) => !h.dontVisit).length;
          const total = (houseData.houses || []).length;
          if (!best || visitable > best.visitable) best = { blockId: b.id, addressId: a.id, total, visitable };
          if (visitable >= 4) break;
        }
        if (best && best.visitable >= 4) break;
      }
      console.log(
        `territory=${t.territoryId} name=${t.name ?? '-'} signedBlocks=${signedBlocks.length} best=${best ? `block=${best.blockId} street=${best.addressId} houses=${best.total} visitable=${best.visitable}` : 'NONE'}`,
      );
    } catch (e) {
      console.log(`territory=${t.territoryId} name=${t.name ?? '-'} ERRO: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
