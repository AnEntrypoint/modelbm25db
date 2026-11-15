#!/usr/bin/env node
// Loud, lazy downloader for the large read-only runtime assets.
// Uses curl for robust large-file downloads on hosts where Node fetch is flaky.
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = process.env.MODELBM25_ROOT || dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MODELBM25_RELEASE ||
  'https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0-data';
const ASSETS = [
  { name: 'modelbm25.sqlite.br', size: 11689182 },
  { name: 'thumbs.pack', size: 38969785 },
];

function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }

async function download(asset) {
  const { name, size } = asset;
  const target = join(ROOT, name);
  const tmp = target + '.part';
  const url = `${BASE}/${name}`;
  console.error(`\n[modelbm25db] DOWNLOAD ${name}`);
  console.error(`[modelbm25db] source ${url}`);
  console.error(`[modelbm25db] expected ${mb(size)} (${size} bytes)`);
  mkdirSync(dirname(target), { recursive: true });
  try { unlinkSync(tmp); } catch {}
  let last = '';
  const ticker = setInterval(() => {
    try {
      const now = statSync(tmp).size;
      console.error(`[modelbm25db] ${name}: ${mb(now)} / ${mb(size)} (${Math.floor(now * 100 / size)}%)`);
    } catch {}
  }, 2000);
  await new Promise((resolve, reject) => {
    const child = spawn('curl', ['-fL', '--retry', '3', '--retry-delay', '1', '--connect-timeout', '20', '--progress-bar', '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { last = (last + chunk).slice(-1000); });
    child.on('error', reject);
    child.on('exit', (code) => { clearInterval(ticker); code === 0 ? resolve() : reject(new Error(`curl exit ${code}: ${last.slice(-300)}`)); });
  });
  const actual = statSync(tmp).size;
  if (actual !== size) { unlinkSync(tmp); throw new Error(`${name}: expected ${size} bytes, got ${actual}`); }
  renameSync(tmp, target);
  console.error(`[modelbm25db] READY ${name} ${mb(actual)} → ${target}\n`);
}

async function ensureData(only = null) {
  let needed = 0;
  for (const asset of ASSETS) {
    if (only && !only.includes(asset.name)) continue;
    const target = join(ROOT, asset.name);
    if (existsSync(target) && statSync(target).size === asset.size) {
      console.error(`[modelbm25db] cached ${asset.name} ${mb(asset.size)}`);
      continue;
    }
    needed += 1;
    await download(asset);
  }
  if (!needed) console.error('[modelbm25db] all requested runtime assets are cached');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureData().catch((e) => { console.error(`[modelbm25db] ERROR ${e.message}`); process.exit(1); });
}

export { ensureData };
