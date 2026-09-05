/**
 * Validação da nova lógica de leave_letter (carta) contra o dump local.
 *
 * Replica a lógica de calculateLeaveLetter em SQL:
 *   carta = tem histórico (rounds mode='default' anteriores) E
 *           NÃO tem visita recente (completed=true com completed_date
 *           NULL ou >= janela) na janela de ROUND_START_DATE_MONTHS.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/territory_manager_production \
 *   npx tsx scripts/validate-leave-letter.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Scenario {
  label: string;
  tenantId: number;
  roundNumber: number; // 0 = rodada hipotética (janela a partir de now())
}

const SCENARIOS: Scenario[] = [
  { label: 'tenant2-round21 (antiga "Campanha" default)', tenantId: 2, roundNumber: 21 },
  { label: 'tenant2-round22 (Residencial)', tenantId: 2, roundNumber: 22 },
  { label: 'tenant2-round23 (Convites Congresso default)', tenantId: 2, roundNumber: 23 },
  { label: 'tenant20-round3 (rodada corrente)', tenantId: 20, roundNumber: 3 },
  { label: 'tenant30-round2 (hipotética)', tenantId: 30, roundNumber: 0 },
];

async function monthsParam(tenantId: number): Promise<number> {
  const p = await prisma.parameter.findFirst({ where: { tenantId, key: 'ROUND_START_DATE_MONTHS' } });
  return p ? parseInt(p.value) : 6;
}

interface ValidationRow {
  total: bigint;
  atuais_true: bigint;
  nova_logica_true: bigint;
}

async function validate(s: Scenario): Promise<void> {
  const months = await monthsParam(s.tenantId);

  const [row] = await prisma.$queryRaw<ValidationRow[]>`
    WITH lim AS (
      SELECT CASE WHEN ${s.roundNumber} = 0
             THEN (SELECT MAX(round_number) + 1 FROM round WHERE tenant_id = ${s.tenantId})
             ELSE ${s.roundNumber} END AS limite
    ),
    p AS (
      SELECT CASE WHEN ${s.roundNumber} = 0 THEN now() ELSE MIN(start_date) END AS created
      FROM round WHERE tenant_id = ${s.tenantId} AND round_number = ${s.roundNumber}
    ),
    casas AS (
      SELECT house_id, leave_letter
      FROM round
      WHERE tenant_id = ${s.tenantId}
        AND (${s.roundNumber} = 0 OR round_number = ${s.roundNumber})
    )
    SELECT
      (SELECT COUNT(*) FROM casas) AS total,
      (SELECT COUNT(*) FROM casas WHERE leave_letter) AS atuais_true,
      COUNT(*) FILTER (WHERE
        EXISTS (
          SELECT 1 FROM round h
          WHERE h.house_id = c.house_id AND h.tenant_id = ${s.tenantId}
            AND h.round_number < (SELECT limite FROM lim) AND h.mode = 'default'
        )
        AND NOT EXISTS (
          SELECT 1 FROM round h
          WHERE h.house_id = c.house_id AND h.tenant_id = ${s.tenantId}
            AND h.round_number < (SELECT limite FROM lim) AND h.mode = 'default'
            AND h.completed = true
            AND (h.completed_date IS NULL OR h.completed_date >= (SELECT created FROM p) - make_interval(months => ${months}::int))
        )
      ) AS nova_logica_true
    FROM casas c CROSS JOIN p;
  `;

  const fmt = (v: bigint) => String(Number(v));
  console.log(
    `${s.label.padEnd(45)} | janela=${String(months).padStart(2)}m | total=${fmt(row.total).padStart(5)} | atuais_true=${fmt(row.atuais_true).padStart(
      5
    )} | nova_logica=${fmt(row.nova_logica_true).padStart(5)}`
  );
}

async function main() {
  console.log('Validação nova lógica leave_letter (dump local limpo)\n');
  for (const s of SCENARIOS) {
    await validate(s);
  }
  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
