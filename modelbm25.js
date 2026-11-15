#!/usr/bin/env node
// Single-file CLI for the modelbm25 SQLite database.
// Usage: node modelbm25.js search "blue ice dragon" [-n 10] [--json]
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const rawDbPath = process.env.MODELBM25_DB || join(root, 'modelbm25.sqlite');
const compactDbPath = rawDbPath.endsWith('.br') ? rawDbPath : rawDbPath + '.br';
const dbPath = existsSync(compactDbPath) ? compactDbPath : rawDbPath;
const VIEW_INSTRUCTION = 'To view thumbnails locally: node modelbm25.js view 8713, then open http://127.0.0.1:8713/';

function openDatabase(path) {
  if (path.endsWith('.br')) {
    const bytes = brotliDecompressSync(readFileSync(path));
    const db = new DatabaseSync(':memory:');
    db.deserialize(bytes, { readOnly: true });
    return db;
  }
  return new DatabaseSync(path, { readOnly: true });
}

function ftsQuery(text) {
  const terms = [...new Set(String(text).toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) || [])];
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function search(query, limit = 10, jsonOut = false, urlsOnly = false) {
  if (!existsSync(dbPath)) {
    console.error(`missing database: ${dbPath}`);
    process.exit(1);
  }
  const db = openDatabase(dbPath);
  const match = ftsQuery(query);
  if (!match) {
    if (jsonOut) console.log(JSON.stringify({ query, count: 0, results: [] }));
    else if (!urlsOnly) console.log(`# ${query} — 0 results`);
    return;
  }
  const rows = db.prepare(`
    select m.hash, m.url, m.label, m.description, m.terms,
           bm25(models_fts) as score
    from models_fts f
    join models m on m.id = f.rowid
    where models_fts match ?
    order by bm25(models_fts)
    limit ?
  `).all(match, limit);
  const results = rows.map((r) => ({
    hash: r.hash,
    url: r.url,
    cdn_url: r.url,
    label: r.label,
    score: Number(r.score),
    terms: JSON.parse(r.terms || '[]'),
    text: r.description,
  }));
  if (urlsOnly) {
    for (const r of results) console.log(r.url);
  } else if (jsonOut) {
    console.log(JSON.stringify({ query, count: results.length, view: VIEW_INSTRUCTION, results }, null, 2));
  } else {
    console.log(`# ${query} — ${results.length} results`);
    for (const r of results) {
      const terms = r.terms.slice(0, 5).map((x) => x.term || x).join(', ');
      console.log(`${Math.abs(r.score).toFixed(4)}  ${r.hash}  ${terms}`);
      console.log(`        ${r.text.slice(0, 180)}`);
      console.log(`        ${r.url}`);
    }
    console.log('');
    console.log(VIEW_INSTRUCTION);
  }
  db.close();
}

function info() {
  if (!existsSync(dbPath)) {
    console.error(`missing database: ${dbPath}`);
    process.exit(1);
  }
  const db = openDatabase(dbPath);
  const count = db.prepare('select count(*) as n from models').get().n;
  const meta = Object.fromEntries(db.prepare('select key, value from meta').all().map((r) => [r.key, r.value]));
  console.log(JSON.stringify({ database: dbPath, bytes: statSync(dbPath).size, documents: count, ...meta }, null, 2));
  db.close();
}

const [, , cmd = 'help', ...args] = process.argv;
if (cmd === 'search') {
  const jsonOut = args.includes('--json');
  const urlsOnly = args.includes('--urls');
  const nArg = args.indexOf('-n');
  const limit = nArg >= 0 ? Number(args[nArg + 1] || 10) : 10;
  const words = args.filter((_, i) => i !== nArg && i !== nArg + 1 && !args[i].startsWith('--'));
  search(words.join(' '), limit, jsonOut, urlsOnly);
} else if (cmd === 'info' || cmd === 'verify') {
  info();
} else if (cmd === 'view') {
  const port = Number(args[0] || process.env.PORT || 8713);
  const child = spawn(process.execPath, [join(root, 'viewer.js'), String(port)], { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  console.log(`usage: node modelbm25.js <search|info> [args]

  search "blue ice dragon" -n 10 [--json|--urls]
  info                  show database path, size, and document count
  view [port]           start the local thumbnail/search viewer (default 8713)

  --urls                print only direct CDN download URLs, one per line
  --json                include both url and cdn_url fields

Environment:
  MODELBM25_DB          override path to modelbm25.sqlite.br`);
}
