import 'dotenv/config';

const BASE = 'https://api-hmg.territory-manager.com.br';
const email = process.env.HMG_ADMIN_EMAIL;
const password = process.env.HMG_ADMIN_PASSWORD;
const round = Number(process.env.HMG_ROUND_NUMBER);

if (!email || !password || !round) throw new Error('env HMG_* ausente');

const TOP14 = [79, 70, 98, 76, 67, 74, 63, 60, 65, 87, 83, 85, 86, 61];
const MIN_HOUSES = 5;
const MAX_BLOCKS_PER_TERRITORY = 4;

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

async function getAddressesRaw(territoryId: number, blockId: number, token: string): Promise<Array<{ id: number }> | null> {
  const res = await fetch(`${BASE}/v1/territories/${territoryId}/blocks/${blockId}?round=${round}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { addresses?: Array<{ id: number }> };
  return data.addresses || [];
}

async function main() {
  const login = await j<{ token: string }>('/v1/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = login.token;

  const results: Array<{ territory: number; name: string; blockId: number; streetId: number; visitable: number; key: string }> = [];

  for (const tid of TOP14) {
    const t = await j<{ name?: string; blocks: Array<{ id: number; name?: string; signature?: { key?: string | null } }> }>(
      `/v1/territories/${tid}?round=${round}`,
      token,
    );
    const name = t.name ?? `territory-${tid}`;
    const blocks = t.blocks || [];
    if (!blocks.length) {
      console.log(`territory=${tid} ${name}: SEM BLOCOS`);
      continue;
    }

    let chosen: { blockId: number; streetId: number; visitable: number; key: string } | null = null;

    for (const b of blocks.slice(0, MAX_BLOCKS_PER_TERRITORY)) {
      // Garantir assinatura do bloco (pública) — POST sem body, auth admin
      let key = b.signature?.key ?? null;
      if (!key) {
        try {
          const res = await j<{ signature?: string; key?: string }>(
            `/v1/territories/${tid}/blocks/${b.id}/signature/${round}`,
            token,
            { method: 'POST' },
          );
          key = typeof res.signature === 'string' ? res.signature : (res.key ?? null);
        } catch (e) {
          console.log(`territory=${tid} ${name} block=${b.id}: ERRO ao assinar: ${(e as Error).message}`);
          continue;
        }
        if (!key) {
          const refreshed = await j<{ blocks: Array<{ id: number; signature?: { key?: string | null } }> }>(
            `/v1/territories/${tid}?round=${round}`,
            token,
          );
          const fresh = refreshed.blocks.find((x) => x.id === b.id);
          key = fresh?.signature?.key ?? null;
        }
        if (!key) {
          console.log(`territory=${tid} ${name} block=${b.id}: assinatura gerada mas key não retornada`);
          continue;
        }
      }

      // Escanear ruas do bloco, escolher a com mais visitáveis
      const addresses = await getAddressesRaw(tid, b.id, token);
      if (!addresses || !addresses.length) continue;

      let best: { streetId: number; visitable: number } | null = null;
      for (const a of addresses) {
        try {
          const h = await j<{ houses: Array<{ id: number; dontVisit?: boolean }> }>(
            `/v1/territories/${tid}/blocks/${b.id}/address/${a.id}?round=${round}`,
            token,
          );
          const visitable = (h.houses || []).filter((x) => !x.dontVisit).length;
          if (!best || visitable > best.visitable) best = { streetId: a.id, visitable };
          if (visitable >= MIN_HOUSES) break;
        } catch {
          // rua sem dados — seguir
        }
      }

      if (best && best.visitable > 0) {
        chosen = { blockId: b.id, streetId: best.streetId, visitable: best.visitable, key };
        if (best.visitable >= MIN_HOUSES) break;
      }
    }

    if (chosen) {
      results.push({ territory: tid, name, blockId: chosen.blockId, streetId: chosen.streetId, visitable: chosen.visitable, key: chosen.key });
      console.log(
        `territory=${tid} ${name}: block=${chosen.blockId} street=${chosen.streetId} visitable=${chosen.visitable} key=${chosen.key}`,
      );
    } else {
      console.log(`territory=${tid} ${name}: NENHUMA rua aproveitável (${MAX_BLOCKS_PER_TERRITORY} blocos tentados)`);
    }
  }

  console.log('\n=== RESUMO FINAL (14 runs) ===');
  for (const r of results) {
    console.log(`${r.territory}|${r.name}|block=${r.blockId}|street=${r.streetId}|visitable=${r.visitable}|key=${r.key}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
