#!/usr/bin/env node

// Compara dois resultados de teste k6 (formato NDJSON do `k6 run --out json=...`)
// Uso: node compare-results.js <hmg.json> <prd.json> <labelHMG> <labelPRD>

const fs = require('fs');

const [hmgFile, prdFile, labelHMG, labelPRD] = process.argv.slice(2);
const LABELS = [labelHMG || 'HMG', labelPRD || 'PRD'];

function parse(file) {
    if (!fs.existsSync(file)) return null;
    const metrics = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let evt;
        try {
            evt = JSON.parse(line);
        } catch {
            continue;
        }
        if (evt.type !== 'Point' && evt.type !== 'Metric') continue;
        // Ponto (amostra): nome no topo (`metric`); definitório de métrica: `data.name`
        const name = evt.metric || evt.data?.name;
        if (!name) continue;
        const value = evt.data?.value;
        if (typeof value !== 'number') continue;
        const tags = evt.data?.tags || {};
        const key = name.startsWith('http_req_duration') && tags.name
            ? `http_req_duration{name:${tags.name}}`
            : name;
        if (!metrics.has(key)) metrics.set(key, []);
        metrics.get(key).push(evt.data.value);
    }
    return metrics;
}

function p95(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function format(v, digits = 1) {
    if (v === null || v === undefined) return '-';
    if (v >= 1000) return `${(v / 1000).toFixed(digits)}s`;
    return `${v.toFixed(digits)}ms`;
}

const hmg = parse(hmgFile);
const prd = parse(prdFile);
if (!hmg && !prd) {
    console.error('Nenhum arquivo de resultado encontrado. Rode os testes primeiro.');
    process.exit(1);
}

const rows = [];
const order = [
    'http_reqs',
    'http_req_failed',
    'http_req_duration',
    'sse_event',
    'checks',
];
// Ruído de sistema — não interessa no comparativo
const NOISE = new Set([
    'vus', 'vus_max', 'iterations', 'iteration_duration',
    'data_sent', 'data_received', 'http_req_blocked', 'http_req_connecting',
    'http_req_tls_handshaking', 'http_req_sending', 'http_req_waiting', 'http_req_receiving',
]);
for (const env of [hmg, prd]) {
    if (!env) continue;
    for (const key of env.keys()) {
        if (NOISE.has(key)) continue;
        if (!order.includes(key) && !key.startsWith('http_req_duration{name:')) order.push(key);
    }
}

for (const key of order) {
    let h = hmg?.get(key) || [];
    let p = prd?.get(key) || [];
    // Global http_req_duration = soma das variantes por endpoint (todo sample tem tag name)
    if (key === 'http_req_duration') {
        h = mergeTagged(hmg);
        p = mergeTagged(prd);
    }
    const row = { key, hmg: null, prd: null };

    if (key === 'http_reqs' || key === 'sse_event') {
        row.hmg = h.length ? String(h.length) : '-';
        row.prd = p.length ? String(p.length) : '-';
    } else if (key === 'http_req_failed' || key === 'checks') {
        row.hmg = h.length ? `${((h.reduce((a, b) => a + b, 0) / h.length) * 100).toFixed(2)}%` : '-';
        row.prd = p.length ? `${((p.reduce((a, b) => a + b, 0) / p.length) * 100).toFixed(2)}%` : '-';
    } else {
        const hP95 = p95(h);
        const pP95 = p95(p);
        const hAvg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : null;
        const pAvg = p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
        row.hmg = h.length ? `${format(hAvg)} (p95 ${format(hP95)})` : '-';
        row.prd = p.length ? `${format(pAvg)} (p95 ${format(pP95)})` : '-';
    }
    rows.push(row);
}

// Junta as variantes http_req_duration{name:*} numa única série
function mergeTagged(metrics) {
    if (!metrics) return [];
    const all = [];
    for (const [key, values] of metrics) {
        if (key.startsWith('http_req_duration{name:')) all.push(...values);
    }
    return all;
}

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(`${pad('Métrica', 38)} | ${pad(LABELS[0], 22)} | ${pad(LABELS[1], 22)}`);
console.log(`${'-'.repeat(38)}-+-${'-'.repeat(22)}-+-${'-'.repeat(22)}`);
for (const r of rows) {
    console.log(`${pad(r.key, 38)} | ${pad(r.hmg, 22)} | ${pad(r.prd, 22)}`);
}

const missing = [];
if (!hmg) missing.push(LABELS[0]);
if (!prd) missing.push(LABELS[1]);
if (missing.length) {
    console.log(`\n⚠️  Sem dados de ${missing.join(' e ')} — arquivo ausente (chave inválida ou erro no setup).`);
}
