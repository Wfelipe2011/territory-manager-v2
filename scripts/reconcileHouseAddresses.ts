/**
 * reconcileHouseAddresses.ts
 *
 * Script de reconciliação idempotente de houses stale.
 * Classifica houses com territory_block_address_id IS NULL e executa
 * reconciliação segura por lote conforme design da change
 * house-territory-address-gap-closure.
 *
 * Uso:
 *   npx tsx scripts/reconcileHouseAddresses.ts [opções]
 *
 * Opções:
 *   --phase <diagnose|auto-link|fix-divergence|zero-gap|all>
 *          Fase a executar (padrão: diagnose)
 *   --mapping <caminho.json>
 *          Arquivo JSON de mapeamento manual para houses ambíguas:
 *          [{ "houseId": 1, "territoryBlockAddressId": 2 }, ...]
 *   --tenant <id>
 *          Filtrar por tenantId (padrão: todos os tenants)
 *   --dry-run
 *          Exibe o que seria alterado sem executar UPDATEs
 *
 * Exemplos:
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase diagnose
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase auto-link --dry-run
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase fix-divergence --dry-run
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase zero-gap
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase purge-orphans --dry-run
 *   npx tsx scripts/reconcileHouseAddresses.ts --phase all --mapping scripts/manual-mapping.json
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HouseDiagnosisResult {
    houseId: number;
    tenantId: number;
    addressId: number;
    blockId: number;
    territoryId: number;
    category: 'auto_linkable' | 'ambiguous' | 'no_territory_block';
    /** ID único do TBA candidato (apenas auto_linkable) */
    tbaId: number | null;
    /** Todos os IDs candidatos (ambiguous) */
    candidates: number[];
}

export interface DivergenceResult {
    houseId: number;
    tenantId: number;
    territoryBlockAddressId: number;
    houseAddressId: number;
    tbaAddressId: number;
}

export interface ManualMapping {
    houseId: number;
    territoryBlockAddressId: number;
}

// ─── CLI Args ─────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const phase: string = getArg(args, '--phase') ?? 'diagnose';
    const mappingPath: string | undefined = getArg(args, '--mapping');
    const tenantArg: string | undefined = getArg(args, '--tenant');
    const tenantId: number | undefined = tenantArg ? parseInt(tenantArg, 10) : undefined;
    const dryRun: boolean = args.includes('--dry-run');
    return { phase, mappingPath, tenantId, dryRun };
}

function getArg(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ─── Bulk Diagnostic (single SQL query) ──────────────────────────────────────

/**
 * Classifica todas as houses stale em uma única query SQL eficiente.
 * Evita N+1 ao usar CTEs e agregações.
 */
export async function bulkClassifyStaleHouses(
    prisma: PrismaClient,
    tenantId: number | undefined,
): Promise<HouseDiagnosisResult[]> {
    type RawRow = {
        house_id: bigint;
        tenant_id: bigint;
        address_id: bigint;
        block_id: bigint;
        territory_id: bigint;
        tba_count: bigint;
        tba_ids: string; // comma-separated ids from STRING_AGG
    };

    const tenantFilter = tenantId !== undefined
        ? Prisma.sql`AND h.tenant_id = ${tenantId}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<RawRow[]>`
        WITH stale AS (
            SELECT h.id, h.address_id, h.block_id, h.territory_id, h.tenant_id
            FROM house h
            WHERE h.territory_block_address_id IS NULL
            ${tenantFilter}
        ),
        tba_candidates AS (
            SELECT
                s.id AS house_id,
                COUNT(tba.id) AS tba_count,
                STRING_AGG(tba.id::text, ',' ORDER BY tba.id) AS tba_ids
            FROM stale s
            LEFT JOIN territory_block tb
                ON tb.block_id = s.block_id
               AND tb.territory_id = s.territory_id
               AND tb.tenant_id = s.tenant_id
            LEFT JOIN territory_block_address tba
                ON tba.territory_block_id = tb.id
               AND tba.address_id = s.address_id
               AND tba.tenant_id = s.tenant_id
            GROUP BY s.id
        )
        SELECT
            s.id AS house_id,
            s.tenant_id,
            s.address_id,
            s.block_id,
            s.territory_id,
            COALESCE(tc.tba_count, 0) AS tba_count,
            COALESCE(tc.tba_ids, '') AS tba_ids
        FROM stale s
        JOIN tba_candidates tc ON tc.house_id = s.id
        ORDER BY s.tenant_id, s.id
    `;

    return rows.map((r) => {
        const tbaCount = Number(r.tba_count);
        const candidateIds = r.tba_ids
            ? r.tba_ids.split(',').filter(Boolean).map(Number)
            : [];

        let category: 'auto_linkable' | 'ambiguous' | 'no_territory_block';
        if (tbaCount === 0) {
            category = 'no_territory_block';
        } else if (tbaCount === 1) {
            category = 'auto_linkable';
        } else {
            category = 'ambiguous';
        }

        return {
            houseId: Number(r.house_id),
            tenantId: Number(r.tenant_id),
            addressId: Number(r.address_id),
            blockId: Number(r.block_id),
            territoryId: Number(r.territory_id),
            category,
            tbaId: category === 'auto_linkable' ? candidateIds[0] : null,
            candidates: candidateIds,
        };
    });
}

// ─── Phases ───────────────────────────────────────────────────────────────────

async function phaseDiagnose(
    prisma: PrismaClient,
    tenantId: number | undefined,
): Promise<{
    results: HouseDiagnosisResult[];
    divergences: DivergenceResult[];
}> {
    console.log('\n=== FASE: DIAGNÓSTICO ===');

    const results = await bulkClassifyStaleHouses(prisma, tenantId);

    const autoLinkable = results.filter((r) => r.category === 'auto_linkable');
    const ambiguous = results.filter((r) => r.category === 'ambiguous');
    const noTerritoryBlock = results.filter((r) => r.category === 'no_territory_block');

    console.log(`Houses stale (territory_block_address_id IS NULL): ${results.length}`);
    console.log(`  auto_linkable:      ${autoLinkable.length}`);
    console.log(`  ambiguous:          ${ambiguous.length}`);
    console.log(`  no_territory_block: ${noTerritoryBlock.length}`);

    if (ambiguous.length > 0) {
        console.log('\n--- Houses ambíguas (requerem mapeamento manual) ---');
        for (const h of ambiguous) {
            console.log(
                `  houseId=${h.houseId} tenantId=${h.tenantId} addressId=${h.addressId} candidates=[${h.candidates.join(', ')}]`,
            );
        }
    }

    if (noTerritoryBlock.length > 0 && noTerritoryBlock.length <= 20) {
        console.log('\n--- Houses sem territory_block (primeiras 20) ---');
        for (const h of noTerritoryBlock) {
            console.log(
                `  houseId=${h.houseId} tenantId=${h.tenantId} addressId=${h.addressId} blockId=${h.blockId} territoryId=${h.territoryId}`,
            );
        }
    } else if (noTerritoryBlock.length > 20) {
        console.log(`\n(${noTerritoryBlock.length} houses no_territory_block — use --tenant <id> para detalhar por tenant)`);
    }

    // Breakdown por tenant para stale
    const byTenant = new Map<number, { auto: number; ambiguous: number; noTb: number }>();
    for (const r of results) {
        const entry = byTenant.get(r.tenantId) ?? { auto: 0, ambiguous: 0, noTb: 0 };
        if (r.category === 'auto_linkable') entry.auto++;
        else if (r.category === 'ambiguous') entry.ambiguous++;
        else entry.noTb++;
        byTenant.set(r.tenantId, entry);
    }
    console.log('\n--- Breakdown por tenant ---');
    for (const [tid, counts] of byTenant) {
        console.log(
            `  tenant=${tid}: auto_linkable=${counts.auto} ambiguous=${counts.ambiguous} no_territory_block=${counts.noTb}`,
        );
    }

    const divergences = await detectDivergences(prisma, tenantId);

    return { results, divergences };
}

export async function detectDivergences(
    prisma: PrismaClient,
    tenantId: number | undefined,
): Promise<DivergenceResult[]> {
    type RawRow = {
        house_id: bigint;
        tenant_id: bigint;
        territory_block_address_id: bigint;
        house_address_id: bigint;
        tba_address_id: bigint;
    };

    const tenantFilter = tenantId !== undefined
        ? Prisma.sql`AND h.tenant_id = ${tenantId}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<RawRow[]>`
        SELECT
            h.id AS house_id,
            h.tenant_id,
            h.territory_block_address_id,
            h.address_id AS house_address_id,
            tba.address_id AS tba_address_id
        FROM house h
        JOIN territory_block_address tba ON tba.id = h.territory_block_address_id
        WHERE h.territory_block_address_id IS NOT NULL
          AND h.address_id <> tba.address_id
          ${tenantFilter}
        ORDER BY h.tenant_id, h.id
    `;

    const divergences: DivergenceResult[] = rows.map((r) => ({
        houseId: Number(r.house_id),
        tenantId: Number(r.tenant_id),
        territoryBlockAddressId: Number(r.territory_block_address_id),
        houseAddressId: Number(r.house_address_id),
        tbaAddressId: Number(r.tba_address_id),
    }));

    console.log(`\nDivergências de address (house.address_id ≠ tba.address_id): ${divergences.length}`);
    for (const d of divergences) {
        console.log(
            `  houseId=${d.houseId} tenantId=${d.tenantId} houseAddressId=${d.houseAddressId} → tbaAddressId=${d.tbaAddressId} (tbaId=${d.territoryBlockAddressId})`,
        );
    }

    return divergences;
}

export async function phaseAutoLink(
    prisma: PrismaClient,
    tenantId: number | undefined,
    dryRun: boolean,
    manualMapping: ManualMapping[],
): Promise<void> {
    console.log('\n=== FASE: AUTO-LINK ===');
    if (dryRun) console.log('[DRY-RUN] Nenhum UPDATE será executado.');

    const results = await bulkClassifyStaleHouses(prisma, tenantId);

    const autoLinkable = results.filter((r) => r.category === 'auto_linkable' && r.tbaId !== null);
    const ambiguous = results.filter((r) => r.category === 'ambiguous');

    console.log(`\nauto_linkable a processar: ${autoLinkable.length}`);

    if (!dryRun && autoLinkable.length > 0) {
        // Agrupar por tbaId para UPDATE em lote por grupo
        const byTba = new Map<number, number[]>();
        for (const h of autoLinkable) {
            const list = byTba.get(h.tbaId!) ?? [];
            list.push(h.houseId);
            byTba.set(h.tbaId!, list);
        }

        let updated = 0;
        for (const [tbaId, houseIds] of byTba) {
            await prisma.house.updateMany({
                where: { id: { in: houseIds } },
                data: { territoryBlockAddressId: tbaId },
            });
            updated += houseIds.length;
        }
        console.log(`Auto-link concluído: ${updated} houses atualizadas.`);
    } else if (dryRun && autoLinkable.length > 0) {
        const preview = autoLinkable.slice(0, 10);
        for (const h of preview) {
            console.log(`  [DRY-RUN] UPDATE house SET territory_block_address_id=${h.tbaId} WHERE id=${h.houseId}`);
        }
        if (autoLinkable.length > 10) {
            console.log(`  ... e mais ${autoLinkable.length - 10} houses`);
        }
        console.log(`Auto-link simulado: ${autoLinkable.length} houses seriam atualizadas.`);
    } else {
        console.log('Nenhuma house auto_linkable encontrada.');
    }

    // Mapeamento manual para ambíguas
    if (manualMapping.length > 0) {
        const ambiguousIds = new Set(ambiguous.map((r) => r.houseId));
        const validMappings = manualMapping.filter((m) => ambiguousIds.has(m.houseId));
        const invalidMappings = manualMapping.filter((m) => !ambiguousIds.has(m.houseId));

        if (invalidMappings.length > 0) {
            console.warn(`\n[AVISO] ${invalidMappings.length} mapeamento(s) para houses não ambíguas ignorados.`);
        }

        console.log(`\nAplicando ${validMappings.length} mapeamento(s) manual(is)...`);
        if (!dryRun) {
            for (const mapping of validMappings) {
                await prisma.house.update({
                    where: { id: mapping.houseId },
                    data: { territoryBlockAddressId: mapping.territoryBlockAddressId },
                });
            }
        } else {
            for (const mapping of validMappings) {
                console.log(`  [DRY-RUN] UPDATE house SET territory_block_address_id=${mapping.territoryBlockAddressId} WHERE id=${mapping.houseId}`);
            }
        }
        console.log(`Mapeamento manual concluído: ${validMappings.length} houses ${dryRun ? '(simuladas)' : 'atualizadas'}.`);
    } else if (ambiguous.length > 0) {
        console.log(`\n[INFO] ${ambiguous.length} house(s) ambígua(s) requerem mapeamento manual.`);
        console.log('       Use --mapping scripts/manual-mapping.json');
        console.log('       Formato: [{ "houseId": <id>, "territoryBlockAddressId": <id> }]');
    }
}

export async function phaseFixDivergence(
    prisma: PrismaClient,
    tenantId: number | undefined,
    dryRun: boolean,
): Promise<void> {
    console.log('\n=== FASE: CORREÇÃO DE DIVERGÊNCIA ===');
    if (dryRun) console.log('[DRY-RUN] Nenhum UPDATE será executado.');

    const divergences = await detectDivergences(prisma, tenantId);

    if (divergences.length === 0) {
        console.log('Nenhuma divergência encontrada. Nada a corrigir.');
        return;
    }

    const auditLog: { houseId: number; tenantId: number; oldAddressId: number; newAddressId: number }[] = [];

    for (const d of divergences) {
        const auditEntry = {
            houseId: d.houseId,
            tenantId: d.tenantId,
            oldAddressId: d.houseAddressId,
            newAddressId: d.tbaAddressId,
        };
        // Log de auditoria ANTES do UPDATE (conforme spec)
        console.log(
            `[AUDIT] houseId=${auditEntry.houseId} tenantId=${auditEntry.tenantId} oldAddressId=${auditEntry.oldAddressId} → newAddressId=${auditEntry.newAddressId}`,
        );
        auditLog.push(auditEntry);

        if (!dryRun) {
            await prisma.house.update({
                where: { id: d.houseId },
                data: { addressId: d.tbaAddressId },
            });
        }
    }

    if (!dryRun) {
        const logsDir = path.join(__dirname, '..', 'logs');
        const auditFilePath = path.join(logsDir, `reconcile-audit-${Date.now()}.json`);
        try {
            fs.mkdirSync(logsDir, { recursive: true });
            fs.writeFileSync(auditFilePath, JSON.stringify(auditLog, null, 2), 'utf-8');
            console.log(`\nLog de auditoria salvo em: ${auditFilePath}`);
        } catch (err) {
            console.warn(`[AVISO] Não foi possível salvar log de auditoria: ${err}`);
        }
    }

    console.log(
        `\nCorreção de divergência concluída: ${divergences.length} houses ${dryRun ? '(simuladas)' : 'atualizadas'}.`,
    );
}

// ─── Quarantine Phase ─────────────────────────────────────────────────────────

/**
 * Fase de quarentena (task 3.2 + 3.3):
 * Identifica e classifica houses no_territory_block em subcategorias.
 * NÃO modifica nenhum dado — apenas documenta exceções permanentes.
 *
 * Estratégia formal (task 3.2):
 *  - orphan   : sem territory_block algum — dados legados pré-territory_block.
 *  - tba_missing: territory_block existe mas address foi removido do bloco.
 *
 * Execução (task 3.3): gera manifesto em logs/reconcile-quarantine-*.json.
 */
export async function phaseQuarantine(
    prisma: PrismaClient,
    tenantId: number | undefined,
): Promise<number> {
    console.log('\n=== FASE: QUARENTENA (no_territory_block) ===');
    console.log('Estratégia: MANTER COMO ESTÁ — sem deletes, sem recriar, sem updates.');
    console.log('  orphan     : dados legados pré-territory_block; irrecuperáveis sem intervenção manual.');
    console.log('  tba_missing: endereços intencionalmente removidos do bloco pelo usuário.');

    type RawRow = {
        house_id: bigint;
        tenant_id: bigint;
        address_id: bigint;
        block_id: bigint;
        territory_id: bigint;
        subcategory: string;
    };

    const tenantFilter = tenantId !== undefined
        ? Prisma.sql`AND h.tenant_id = ${tenantId}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<RawRow[]>`
        WITH stale AS (
            SELECT h.id, h.address_id, h.block_id, h.territory_id, h.tenant_id
            FROM house h
            WHERE h.territory_block_address_id IS NULL
            ${tenantFilter}
        ),
        tb_check AS (
            SELECT
                s.id AS house_id,
                COUNT(tba.id)::bigint AS tba_count,
                MAX(CASE WHEN tb.id IS NOT NULL THEN 1 ELSE 0 END) AS has_tb
            FROM stale s
            LEFT JOIN territory_block tb
                ON tb.block_id = s.block_id
               AND tb.territory_id = s.territory_id
               AND tb.tenant_id = s.tenant_id
            LEFT JOIN territory_block_address tba
                ON tba.territory_block_id = tb.id
               AND tba.address_id = s.address_id
               AND tba.tenant_id = s.tenant_id
            GROUP BY s.id
        )
        SELECT
            s.id AS house_id,
            s.tenant_id,
            s.address_id,
            s.block_id,
            s.territory_id,
            CASE
                WHEN COALESCE(tc.has_tb, 0) = 0 THEN 'orphan'
                ELSE 'tba_missing'
            END AS subcategory
        FROM stale s
        JOIN tb_check tc ON tc.house_id = s.id
        WHERE COALESCE(tc.tba_count, 0) = 0
        ORDER BY s.tenant_id, s.id
    `;

    const orphan = rows.filter((r) => r.subcategory === 'orphan');
    const tbaMissing = rows.filter((r) => r.subcategory === 'tba_missing');

    console.log(`\nHouses no_territory_block encontradas: ${rows.length}`);
    console.log(`  orphan (sem territory_block algum):        ${orphan.length}`);
    console.log(`  tba_missing (tb existe, TBA não):          ${tbaMissing.length}`);

    // Breakdown por tenant
    const byTenant = new Map<number, { orphan: number; tbaMissing: number }>();
    for (const r of rows) {
        const tid = Number(r.tenant_id);
        const entry = byTenant.get(tid) ?? { orphan: 0, tbaMissing: 0 };
        if (r.subcategory === 'orphan') entry.orphan++;
        else entry.tbaMissing++;
        byTenant.set(tid, entry);
    }
    if (byTenant.size > 0) {
        console.log('\n--- Breakdown por tenant (quarentena) ---');
        for (const [tid, counts] of byTenant) {
            console.log(`  tenant=${tid}: orphan=${counts.orphan} tba_missing=${counts.tbaMissing}`);
        }
    }

    // Save quarantine manifest
    const quarantineReport = {
        generatedAt: new Date().toISOString(),
        strategy: 'quarantine',
        rationale: {
            orphan: 'Dados legados importados antes da tabela territory_block existir. Sem territory_block correspondente — irrecuperáveis sem intervenção manual. Deletar destruiria histórico de rounds.',
            tba_missing: 'territory_block existe mas address foi intencionalmente removido do bloco via manageAddresses. Recriar TBA reintroduziria casas em blocos que o usuário limpou.',
        },
        totals: { orphan: orphan.length, tbaMissing: tbaMissing.length, total: rows.length },
        houses: rows.map((r) => ({
            houseId: Number(r.house_id),
            tenantId: Number(r.tenant_id),
            addressId: Number(r.address_id),
            blockId: Number(r.block_id),
            territoryId: Number(r.territory_id),
            subcategory: r.subcategory,
        })),
    };

    const logsDir = path.join(__dirname, '..', 'logs');
    const quarantineFilePath = path.join(logsDir, `reconcile-quarantine-${Date.now()}.json`);
    try {
        fs.mkdirSync(logsDir, { recursive: true });
        fs.writeFileSync(quarantineFilePath, JSON.stringify(quarantineReport, null, 2), 'utf-8');
        console.log(`\nRelatório de quarentena salvo em: ${quarantineFilePath}`);
    } catch (err) {
        console.warn(`[AVISO] Não foi possível salvar relatório de quarentena: ${err}`);
    }

    console.log('\n[DECISÃO task 3.2] Estratégia executada: QUARENTENA.');
    console.log('  Nenhuma house foi deletada, recriada ou modificada.');
    console.log(`  ${rows.length} house(s) documentadas como exceção permanente ao zero-gap global.`);
    console.log('  Zero-gap para house-territory-address-db-hardening considera apenas houses LINKÁVEIS.');

    return rows.length;
}

// ─── Purge Orphans Phase ─────────────────────────────────────────────────────

/**
 * Deleta permanentemente houses orphan (sem territory_block correspondente)
 * e seus rounds associados. Suporta --dry-run.
 * Salva log de auditoria em logs/reconcile-purge-orphans-*.json.
 */
export async function phasePurgeOrphans(
    prisma: PrismaClient,
    tenantId: number | undefined,
    dryRun: boolean,
): Promise<void> {
    console.log('\n=== FASE: PURGE DE ORPHANS ===');
    if (dryRun) console.log('[DRY-RUN] Nenhum DELETE será executado.');

    const tenantFilter = tenantId !== undefined
        ? Prisma.sql`AND h.tenant_id = ${tenantId}`
        : Prisma.empty;

    type RawRow = { house_id: bigint; tenant_id: bigint };
    const rows = await prisma.$queryRaw<RawRow[]>`
        WITH stale AS (
            SELECT h.id, h.block_id, h.territory_id, h.tenant_id
            FROM house h
            WHERE h.territory_block_address_id IS NULL
            ${tenantFilter}
        )
        SELECT s.id AS house_id, s.tenant_id
        FROM stale s
        WHERE NOT EXISTS (
            SELECT 1
            FROM territory_block tb
            WHERE tb.block_id = s.block_id
              AND tb.territory_id = s.territory_id
              AND tb.tenant_id = s.tenant_id
        )
        ORDER BY s.tenant_id, s.id
    `;

    const orphanHouseIds = rows.map((r) => Number(r.house_id));

    if (orphanHouseIds.length === 0) {
        console.log('Nenhuma house orphan encontrada. Nada a deletar.');
        return;
    }

    console.log(`Houses orphan a deletar: ${orphanHouseIds.length}`);

    // Contar rounds associados
    const roundCount = await prisma.round.count({
        where: { houseId: { in: orphanHouseIds } },
    });
    console.log(`Rounds associados a deletar: ${roundCount}`);

    // Breakdown por tenant
    const byTenant = new Map<number, number[]>();
    for (const r of rows) {
        const tid = Number(r.tenant_id);
        const list = byTenant.get(tid) ?? [];
        list.push(Number(r.house_id));
        byTenant.set(tid, list);
    }
    console.log('\n--- Breakdown por tenant ---');
    for (const [tid, ids] of byTenant) {
        console.log(`  tenant=${tid}: ${ids.length} house(s) orphan`);
    }

    const auditLog = rows.map((r) => ({
        houseId: Number(r.house_id),
        tenantId: Number(r.tenant_id),
    }));

    if (!dryRun) {
        // Deletar rounds primeiro (FK dependency)
        const deletedRounds = await prisma.round.deleteMany({
            where: { houseId: { in: orphanHouseIds } },
        });
        console.log(`\nRounds deletados: ${deletedRounds.count}`);

        const deletedHouses = await prisma.house.deleteMany({
            where: { id: { in: orphanHouseIds } },
        });
        console.log(`Houses orphan deletadas: ${deletedHouses.count}`);

        // Salvar log de auditoria
        const logsDir = path.join(__dirname, '..', 'logs');
        const auditFilePath = path.join(logsDir, `reconcile-purge-orphans-${Date.now()}.json`);
        try {
            fs.mkdirSync(logsDir, { recursive: true });
            fs.writeFileSync(auditFilePath, JSON.stringify(auditLog, null, 2), 'utf-8');
            console.log(`\nLog de auditoria salvo em: ${auditFilePath}`);
        } catch (err) {
            console.warn(`[AVISO] Não foi possível salvar log de auditoria: ${err}`);
        }
    } else {
        const preview = orphanHouseIds.slice(0, 10);
        for (const id of preview) {
            console.log(`  [DRY-RUN] DELETE FROM house WHERE id=${id}`);
        }
        if (orphanHouseIds.length > 10) {
            console.log(`  ... e mais ${orphanHouseIds.length - 10} houses`);
        }
    }

    console.log(`\nPurge de orphans concluído: ${orphanHouseIds.length} house(s) e ${roundCount} round(s) ${dryRun ? '(simulados)' : 'deletados'}.`);
}

async function phaseZeroGap(
    prisma: PrismaClient,
    tenantId: number | undefined,
): Promise<void> {
    console.log('\n=== FASE: GATE DE ZERO-GAP ===');
    const date = new Date().toISOString();

    // Count quarantine exceptions (no_territory_block) to compute net unresolved
    const tenantFilter = tenantId !== undefined
        ? Prisma.sql`AND h.tenant_id = ${tenantId}`
        : Prisma.empty;

    type NtbRow = { count: bigint };
    const ntbRows = await prisma.$queryRaw<NtbRow[]>`
        WITH stale AS (
            SELECT h.id, h.block_id, h.territory_id, h.tenant_id, h.address_id
            FROM house h
            WHERE h.territory_block_address_id IS NULL
            ${tenantFilter}
        )
        SELECT COUNT(s.id)::bigint AS count
        FROM stale s
        WHERE NOT EXISTS (
            SELECT 1
            FROM territory_block tb
            JOIN territory_block_address tba ON tba.territory_block_id = tb.id
            WHERE tb.block_id = s.block_id
              AND tb.territory_id = s.territory_id
              AND tb.tenant_id = s.tenant_id
              AND tba.address_id = s.address_id
              AND tba.tenant_id = s.tenant_id
        )
    `;
    const quarantineCount = Number(ntbRows[0]?.count ?? 0);

    if (tenantId !== undefined) {
        const totalStale = await prisma.house.count({
            where: { territoryBlockAddressId: null, tenantId },
        });
        const netUnresolved = totalStale - quarantineCount;
        console.log(`[${date}] Tenant ${tenantId}: total stale=${totalStale} | quarentena=${quarantineCount} | net não resolvido=${netUnresolved}`);

        if (netUnresolved === 0) {
            console.log('✓ ZERO-GAP LINKÁVEL CONFIRMADO — pré-condição para house-territory-address-db-hardening LIBERADA.');
            if (quarantineCount > 0) {
                console.log(`  (${quarantineCount} exceção(ões) permanente(s) de quarentena — ver logs/reconcile-quarantine-*.json)`);
            }
        } else {
            console.log(`✗ ZERO-GAP NÃO ATINGIDO — ${netUnresolved} house(s) linkável(eis) ainda sem vínculo.`);
            process.exitCode = 1;
        }
    } else {
        type GapRow = { tenant_id: bigint; count: bigint };
        const rows = await prisma.$queryRaw<GapRow[]>`
            SELECT tenant_id, COUNT(*) AS count
            FROM house
            WHERE territory_block_address_id IS NULL
            GROUP BY tenant_id
            ORDER BY tenant_id
        `;

        if (rows.length === 0) {
            console.log(`[${date}] ✓ ZERO-GAP CONFIRMADO (todos os tenants) — pré-condição para house-territory-address-db-hardening LIBERADA.`);
        } else {
            console.log(`[${date}] Tenants com houses stale:`);
            let totalStale = 0;
            for (const row of rows) {
                const cnt = Number(row.count);
                totalStale += cnt;
                console.log(`  tenantId=${Number(row.tenant_id)}: ${cnt} house(s) sem vínculo`);
            }
            const netUnresolved = totalStale - quarantineCount;
            console.log(`\nTotal stale: ${totalStale} | Quarentena: ${quarantineCount} | Net não resolvido: ${netUnresolved}`);
            if (netUnresolved === 0) {
                console.log('✓ ZERO-GAP LINKÁVEL CONFIRMADO — todas as houses linkáveis foram reconciliadas.');
                console.log(`  (${quarantineCount} exceção(ões) permanente(s) de quarentena — ver logs/reconcile-quarantine-*.json)`);
            } else {
                console.log(`✗ ZERO-GAP NÃO ATINGIDO — ${netUnresolved} house(s) linkável(eis) ainda sem vínculo.`);
                process.exitCode = 1;
            }
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { phase, mappingPath, tenantId, dryRun } = parseArgs();

    console.log('====================================================');
    console.log(' reconcileHouseAddresses.ts');
    console.log('====================================================');
    console.log(`Fase:     ${phase}`);
    console.log(`TenantId: ${tenantId ?? 'todos'}`);
    console.log(`DryRun:   ${dryRun}`);
    console.log(`Mapping:  ${mappingPath ?? 'nenhum'}`);

    let manualMapping: ManualMapping[] = [];
    if (mappingPath) {
        const raw = fs.readFileSync(mappingPath, 'utf-8');
        manualMapping = JSON.parse(raw) as ManualMapping[];
        console.log(`Mapeamento manual carregado: ${manualMapping.length} entradas`);
    }

    const prisma = new PrismaClient({ log: ['error'] });

    try {
        await prisma.$connect();

        switch (phase) {
            case 'diagnose':
                await phaseDiagnose(prisma, tenantId);
                break;
            case 'auto-link':
                await phaseAutoLink(prisma, tenantId, dryRun, manualMapping);
                break;
            case 'fix-divergence':
                await phaseFixDivergence(prisma, tenantId, dryRun);
                break;
            case 'quarantine':
                await phaseQuarantine(prisma, tenantId);
                break;
            case 'zero-gap':
                await phaseZeroGap(prisma, tenantId);
                break;
            case 'purge-orphans':
                await phasePurgeOrphans(prisma, tenantId, dryRun);
                break;
            case 'all':
                await phaseDiagnose(prisma, tenantId);
                await phaseAutoLink(prisma, tenantId, dryRun, manualMapping);
                await phaseFixDivergence(prisma, tenantId, dryRun);
                await phaseQuarantine(prisma, tenantId);
                await phaseZeroGap(prisma, tenantId);
                break;
            default:
                console.error(`Fase desconhecida: "${phase}". Use: diagnose | auto-link | fix-divergence | quarantine | zero-gap | purge-orphans | all`);
                process.exit(1);
        }
    } finally {
        await prisma.$disconnect();
    }

    console.log('\n====================================================');
    console.log(' Concluído.');
    console.log('====================================================');
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Erro fatal:', err);
        process.exit(1);
    });
}
