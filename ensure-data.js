#!/usr/bin/env node
// Download the large read-only runtime assets on demand.
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MODELBM25_RELEASE ||
  'https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0';
const assets = [
  ['modelbm25.sqlite.br', 11689182],
  ['thumbs.pack', 38969785],
];

async function ensure() {
  for (const [name, expected] of assets) {
    const target = join(ROOT, name);
    if (existsSync(target) && statSync(target).size === expected) continue;
    const url = `${BASE}/${name}`;
    process.stderr.write(`modelbm25db: fetching ${name} from ${url}\n`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length !== expected) throw new Error(`${name}: expected ${expected} bytes, got ${bytes.length}`);
    writeFileSync(target, bytes);
  }
  process.stderr.write('modelbm25db: runtime assets ready\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensure().catch((e) => { console.error(e.message); process.exit(1); });
}

export { ensure };
