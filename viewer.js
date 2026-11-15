#!/usr/bin/env node
// Local viewer for modelbm25.sqlite.br + thumbs.pack.
// On-demand: node viewer.js [port]
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, openSync, readSync, closeSync, statSync, existsSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensure } from './ensure-data.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
await ensure();
const DB_PATH = process.env.MODELBM25_DB || join(ROOT, 'modelbm25.sqlite.br');
const PACK_PATH = process.env.MODELBM25_THUMBS || join(ROOT, 'thumbs.pack');
const PORT = Number(process.argv[2] || process.env.PORT || 8713);
const HOST = process.env.HOST || '127.0.0.1';
const VIEW_INSTRUCTION = `Thumbnails are served on demand from thumbs.pack at ${HOST}:${PORT}; open this page at http://${HOST}:${PORT}/`;

if (!existsSync(DB_PATH) || !existsSync(PACK_PATH)) {
  console.error(`missing runtime files: ${DB_PATH} and/or ${PACK_PATH}`);
  process.exit(1);
}

const dbBytes = brotliDecompressSync(readFileSync(DB_PATH));
const db = new DatabaseSync(':memory:');
db.deserialize(dbBytes, { readOnly: true });

// thumbs.pack format: 13-byte header, sorted 38-byte records, WebP sheet blobs.
const pack = readFileSync(PACK_PATH);
const recordOffset = 13;
const recordSize = 38;
const blobBase = 1807749;
const count = (blobBase - recordOffset) / recordSize;
const hashToRecord = new Map();
for (let i = 0; i < count; i++) {
  const off = recordOffset + i * recordSize;
  const hash = pack.subarray(off, off + 32).toString('hex');
  hashToRecord.set(hash, { offset: pack.readUInt32LE(off + 32), length: pack.readUInt16LE(off + 36) });
}

function ftsQuery(text) {
  const terms = [...new Set(String(text).toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) || [])];
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function htmlPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>modelbm25 viewer</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#0b1020;color:#e8edf8}header{position:sticky;top:0;z-index:2;padding:1rem;background:#111a33;border-bottom:1px solid #27345b}form{display:flex;gap:.5rem;max-width:900px;margin:auto}input{flex:1;padding:.7rem;border-radius:6px;border:1px solid #46568a;background:#0b1020;color:#fff}button{padding:.7rem 1rem;border:0;border-radius:6px;background:#4772ff;color:#fff}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;padding:1rem}.card{background:#141e3a;border:1px solid #27345b;border-radius:8px;overflow:hidden}.thumb{width:100%;aspect-ratio:1;background:#040909 center/contain no-repeat}.meta{padding:.6rem;font-size:12px}.meta a{color:#8db4ff;word-break:break-all}.desc{color:#b8c4de;max-height:4.2em;overflow:hidden}</style></head>
<body><header><form id="f"><input id="q" value="blue ice dragon" autocomplete="off"><button>Search</button></form></header><main id="grid"></main><footer style="padding:1rem;color:#8fa0c8">Thumbnails are served on demand from <code>thumbs.pack</code> by this local viewer.</footer>
<script>
const grid=document.getElementById('grid'),q=document.getElementById('q');
async function run(e){if(e)e.preventDefault();const r=await fetch('/api/search?q='+encodeURIComponent(q.value)+'&n=30');const d=await r.json();grid.innerHTML='';for(const x of d.results){const el=document.createElement('div');el.className='card';const img=document.createElement('div');img.className='thumb';img.style.backgroundImage='url(/thumb/'+x.hash+'.webp)';const meta=document.createElement('div');meta.className='meta';const a=document.createElement('a');a.href=x.url;a.textContent=x.url;a.target='_blank';const desc=document.createElement('div');desc.className='desc';desc.textContent=x.text;meta.append(a,document.createElement('br'),desc);el.append(img,meta);grid.append(el)}}
document.getElementById('f').addEventListener('submit',run);run();
</script></body></html>`;
}

function searchRows(query, limit) {
  const match = ftsQuery(query);
  if (!match) return [];
  return db.prepare(`
    select m.hash, m.url, m.description, m.terms, bm25(models_fts) score
    from models_fts f join models m on m.id=f.rowid
    where models_fts match ? order by bm25(models_fts) limit ?
  `).all(match, limit).map((r) => ({
    hash: r.hash, url: r.url, cdn_url: r.url,
    text: r.description, score: Number(r.score),
    terms: JSON.parse(r.terms || '[]'),
  }));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(htmlPage());
    return;
  }
  if (u.pathname === '/api/info') {
    json(res, 200, { documents: db.prepare('select count(*) n from models').get().n, thumbs: count, database: DB_PATH, pack: PACK_PATH, view: VIEW_INSTRUCTION });
    return;
  }
  if (u.pathname === '/api/search') {
    const q = u.searchParams.get('q') || '';
    const n = Math.min(100, Math.max(1, Number(u.searchParams.get('n') || 20)));
    const results = searchRows(q, n);
    json(res, 200, { query: q, count: results.length, view: VIEW_INSTRUCTION, results });
    return;
  }
  const thumb = u.pathname.match(/^\/thumb\/([0-9a-f]{64})\.webp$/);
  if (thumb) {
    const rec = hashToRecord.get(thumb[1]);
    if (!rec) { res.writeHead(404).end('missing thumb'); return; }
    const start = rec.offset;
    const body = pack.subarray(start, start + rec.length);
    res.writeHead(200, { 'content-type': 'image/webp', 'content-length': body.length, 'cache-control': 'public,max-age=86400' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
});

server.listen(PORT, HOST, () => {
  console.log(`modelbm25 viewer: http://${HOST}:${PORT}/`);
  console.log(`database: ${DB_PATH} (${statSync(DB_PATH).size} bytes)`);
  console.log(`thumbs: ${PACK_PATH} (${count} models, ${statSync(PACK_PATH).size} bytes)`);
});
