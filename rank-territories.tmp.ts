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
  const unique = [...new Map(territories.map((t) => [t.territoryId, t])).values()];

  const ranked: Array<{ territoryId: number; name: string; blocks: number; signed: number }> = [];
  for (const t of unique) {
    try {
      const blocksData = await j<{ blocks: Array<{ id: number; signature?: { key?: string | null } }> }>(
        `/v1/territories/${t.territoryId}?round=${round}`,
        token,
      );
      const blocks = blocksData.blocks || [];
      ranked.push({
        territoryId: t.territoryId,
        name: t.name ?? '-',
        blocks: blocks.length,
        signed: blocks.filter((b) => b.signature?.key).length,
      });
    } catch (e) {
      ranked.push({ territoryId: t.territoryId, name: `${t.name ?? '-'} (sem histórico)`, blocks: -1, signed: 0 });
    }
  }

  ranked.sort((a, b) => b.blocks - a.blocks);
  for (const r of ranked) {
    console.log(`territory=${r.territoryId} name=${r.name} blocks=${r.blocks} signed=${r.signed}`);
  }
  const top = ranked.filter((r) => r.blocks > 0).slice(0, 14);
  console.log('\nTOP 14: ' + top.map((r) => r.territoryId).join(','));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
