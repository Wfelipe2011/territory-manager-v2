import 'dotenv/config';

import { parseArgs } from 'node:util';

const HMG_BASE_URL = 'https://api-hmg.territory-manager.com.br';

interface CliArgs {
  territory: number;
  round: number;
  overseer: string;
  expiration: string;
  email: string;
  password: string;
  baseUrl: string;
}

function parseCli(): CliArgs {
  const parsed = parseArgs({
    options: {
      territory: { type: 'string', default: process.env.HMG_TERRITORY_ID },
      round: { type: 'string', default: process.env.HMG_ROUND_NUMBER },
      overseer: { type: 'string', default: 'k6-load-tester' },
      expiration: { type: 'string', default: '2026-12-31' },
      email: { type: 'string', default: process.env.HMG_ADMIN_EMAIL },
      password: { type: 'string', default: process.env.HMG_ADMIN_PASSWORD },
      baseUrl: { type: 'string', default: HMG_BASE_URL },
    },
  });

  const territory = Number(parsed.values.territory);
  const round = Number(parsed.values.round);

  if (isNaN(territory) || territory < 1) throw new Error('--territory é obrigatório (ex: --territory 3)');
  if (isNaN(round) || round < 1) throw new Error('--round é obrigatório (ex: --round 10)');
  if (!parsed.values.email) throw new Error('--email é obrigatório (ou env HMG_ADMIN_EMAIL)');
  if (!parsed.values.password) throw new Error('--password é obrigatório (ou env HMG_ADMIN_PASSWORD)');

  return {
    territory,
    round,
    overseer: parsed.values.overseer,
    expiration: parsed.values.expiration,
    email: parsed.values.email,
    password: parsed.values.password,
    baseUrl: parsed.values.baseUrl.replace(/\/$/, ''),
  };
}

async function main() {
  const cli = parseCli();
  const baseUrl = cli.baseUrl;

  console.log(`[signature-key] baseUrl=${baseUrl} | território=${cli.territory} | round=${cli.round}`);

  const loginRes = await fetch(`${baseUrl}/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cli.email, password: cli.password }),
  });
  if (!loginRes.ok) {
    throw new Error(`Falha no login: HTTP ${loginRes.status} ${await loginRes.text()}`);
  }
  const { token } = (await loginRes.json()) as { token: string };

  const signatureRes = await fetch(`${baseUrl}/v1/territories/${cli.territory}/signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      expirationTime: cli.expiration,
      overseer: cli.overseer,
      round: cli.round,
    }),
  });
  if (!signatureRes.ok) {
    throw new Error(`Falha ao gerar assinatura: HTTP ${signatureRes.status} ${await signatureRes.text()}`);
  }
  const { signature } = (await signatureRes.json()) as { signature: string };

  console.log(`[signature-key] SIGNATURE_KEY=${signature}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
