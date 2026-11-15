#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const ROOT = process.env.MODELBM25_ROOT || dirname(fileURLToPath(import.meta.url))
const WASM_URL = process.env.MODELBM25_WASM_URL || 'https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0-data/modelbm25.wasm'
const WASM_PATH = process.env.MODELBM25_WASM || join(ROOT, 'modelbm25.wasm')

let cached = null
let cachedWasm = null

function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB' }

function nodeError(error) { return new Error(String(error && error.message ? error.message : error)) }

function download(url, target, expectedBytes, label) {
  return new Promise((done, fail) => {
    mkdirSync(dirname(target), { recursive: true })
    const temp = target + '.part'
    try { unlinkSync(temp) } catch {}
    if (expectedBytes) console.error('[modelbm25db] DOWNLOAD ' + label + ' ' + mb(expectedBytes))
    console.error('[modelbm25db] source ' + url)
    let last = ''
    const ticker = setInterval(() => {
      try {
        const size = statSync(temp).size
        console.error('[modelbm25db] ' + label + ' ' + mb(size) + (expectedBytes ? ' / ' + mb(expectedBytes) + ' (' + Math.floor(size * 100 / expectedBytes) + '%)' : ''))
      } catch {}
    }, 2000)
    const child = spawn('curl', ['-fL', '--retry', '3', '--retry-delay', '1', '--connect-timeout', '20', '--progress-bar', '-o', temp, url], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { last = (last + chunk).slice(-1000) })
    child.on('error', (error) => { clearInterval(ticker); fail(nodeError(error)) })
    child.on('exit', (code) => {
      clearInterval(ticker)
      if (code !== 0) { fail(new Error('curl exit ' + code + ': ' + last.slice(-300))); return }
      const size = statSync(temp).size
      if (expectedBytes && size !== expectedBytes) { try { unlinkSync(temp) } catch {} ; fail(new Error(label + ': expected ' + expectedBytes + ' bytes, got ' + size)); return }
      renameSync(temp, target)
      console.error('[modelbm25db] READY ' + label + ' ' + mb(size) + ' -> ' + target)
      done(target)
    })
  })
}

function runWasm(bytes) {
  const module = new WebAssembly.Module(bytes)
  const memory = []
  let output = ''
  const decoder = new TextDecoder()
  const fdWrite = (fd, iovs, iovsLen, written) => {
    const view = new DataView(memory[0].buffer)
    const base = iovs >>> 0
    let total = 0
    for (let i = 0; i < iovsLen; i++) {
      const start = view.getUint32(base + i * 8, true)
      const length = view.getUint32(base + i * 8 + 4, true)
      output += decoder.decode(new Uint8Array(memory[0].buffer, start, length))
      total += length
    }
    view.setUint32(written >>> 0, total, true)
    return 0
  }
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: { fd_write: fdWrite } })
  memory[0] = instance.exports.memory
  instance.exports.main()
  return output
}

async function ensureWasm() {
  if (cachedWasm) return cachedWasm
  if (!existsSync(WASM_PATH) || statSync(WASM_PATH).size === 0) await download(WASM_URL, WASM_PATH, 0, 'modelbm25.wasm')
  cachedWasm = readFileSync(WASM_PATH)
  return cachedWasm
}

export async function loadManifest() {
  if (cached) return cached
  const manifest = JSON.parse(runWasm(await ensureWasm()).replace(/\n/g, ''))
  const format = manifest.thumbs
  const bytes = Buffer.from(manifest.table, format.encoding)
  const thumbTable = []
  for (let at = 0; at + format.recordSize <= bytes.length; at += format.recordSize) {
    thumbTable.push([bytes.subarray(at, at + format.hashBytes).toString('hex'), bytes.readUInt32LE(at + format.offsetAt), bytes.readUInt16LE(at + format.lengthAt)])
  }
  manifest.thumbTable = thumbTable
  cached = manifest
  return cached
}

export async function ensureData(only = null, folder = ROOT) {
  const manifest = await loadManifest()
  let needed = 0
  for (const file of manifest.files) {
    if (only && !only.includes(file.name)) continue
    const target = join(folder, file.name)
    if (existsSync(target) && statSync(target).size === file.bytes) {
      console.error('[modelbm25db] cached ' + file.name + ' ' + mb(file.bytes))
      continue
    }
    needed += 1
    await download(file.url, target, file.bytes, file.name)
  }
  if (needed === 0) console.error('[modelbm25db] all requested runtime assets are cached')
  return manifest
}

async function ensure(only) { return ensureData(only) }

export async function extract(folder = 'modelbm25-extract', options = {}) {
  const root = resolve(folder)
  const filesDir = join(root, 'files')
  const thumbsDir = join(root, 'thumbs')
  const manifest = await ensureData(null, filesDir)
  mkdirSync(filesDir, { recursive: true })
  mkdirSync(thumbsDir, { recursive: true })
  const pack = readFileSync(join(filesDir, manifest.thumbs.pack))
  const index = []
  if (options.thumbs !== false) {
    for (const row of manifest.thumbTable) {
      writeFileSync(join(thumbsDir, row[0] + '.webp'), pack.subarray(row[1], row[1] + row[2]))
      index.push({ hash: row[0], file: 'thumbs/' + row[0] + '.webp', offset: row[1], length: row[2] })
    }
  }
  writeFileSync(join(thumbsDir, 'index.json'), JSON.stringify(index))
  return {
    folder: root,
    wasm: WASM_PATH,
    releaseUrl: manifest.releaseUrl,
    files: manifest.files.map((file) => ({ name: file.name, path: join('files', file.name), url: file.url, bytes: file.bytes, sha256: file.sha256 })),
    thumbs: { folder: 'thumbs', count: options.thumbs === false ? 0 : index.length, index: 'thumbs/index.json', packUrl: manifest.thumbs.url, target: manifest.thumbs.target }
  }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2)
  const folderAt = args.indexOf('--folder')
  const folder = folderAt >= 0 ? args[folderAt + 1] : (args.find((arg) => !arg.startsWith('--')) || null)
  const task = folder ? extract(folder, { thumbs: !args.includes('--no-thumbs') }) : ensureData()
  task.then((result) => { if (folder) console.log(JSON.stringify(result, null, 2)) }).catch((error) => { console.error('[modelbm25db] ERROR ' + nodeError(error).message); process.exit(1) })
}

export { ensure, runWasm }
