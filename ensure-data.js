#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { instantiate } from 'jz/interop'

const ROOT = process.env.MODELBM25_ROOT || dirname(fileURLToPath(import.meta.url))
const WASM_URL = process.env.MODELBM25_WASM_URL || 'https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0-data/modelbm25.wasm'
const WASM_PATH = process.env.MODELBM25_WASM || join(ROOT, 'modelbm25.wasm')
const SECTION = 'modelbm25'
const decoder = new TextDecoder()

let kernel = null

function mb(n) { return (n / 1024 / 1024).toFixed(1) + ' MB' }

function download(url, target) {
  return new Promise((done, fail) => {
    mkdirSync(dirname(target), { recursive: true })
    const temp = target + '.part'
    try { unlinkSync(temp) } catch {}
    console.error('[modelbm25db] source ' + url)
    let last = ''
    const ticker = setInterval(() => {
      try { console.error('[modelbm25db] modelbm25.wasm ' + mb(statSync(temp).size)) } catch {}
    }, 2000)
    const child = spawn('curl', ['-fL', '--http1.1', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '--connect-timeout', '20', '--progress-bar', '-o', temp, url], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { last = (last + chunk).slice(-1000) })
    child.on('error', (error) => { clearInterval(ticker); fail(error) })
    child.on('exit', (code) => {
      clearInterval(ticker)
      if (code !== 0) { fail(new Error('curl exit ' + code + ': ' + last.slice(-300))); return }
      renameSync(temp, target)
      console.error('[modelbm25db] READY modelbm25.wasm ' + mb(statSync(target).size) + ' -> ' + target)
      done(target)
    })
  })
}

export async function ensureWasm() {
  if (!existsSync(WASM_PATH) || statSync(WASM_PATH).size === 0) await download(WASM_URL, WASM_PATH)
  return WASM_PATH
}

export async function openKernel() {
  if (kernel) return kernel
  const bytes = readFileSync(await ensureWasm())
  const [payload] = WebAssembly.Module.customSections(new WebAssembly.Module(bytes), SECTION)
  const instance = instantiate(bytes)
  instance.exports.blob.set(new Uint8Array(payload))
  kernel = instance.exports
  return kernel
}

export function readJson(exports, length) {
  return JSON.parse(decoder.decode(exports.json.subarray(0, length)))
}

export async function info() {
  const k = await openKernel()
  return readJson(k, k.info())
}

export async function search(query, limit, withThumbs) {
  const k = await openKernel()
  const bytes = Buffer.from(query, 'utf8').subarray(0, k.input.length)
  k.input.set(bytes)
  return readJson(k, k.search(bytes.length, limit, withThumbs ? 1 : 0))
}

export async function listThumbs(start, max) {
  const k = await openKernel()
  return readJson(k, k.listThumbs(start, max))
}

export async function thumbBytes(item) {
  const k = await openKernel()
  return Buffer.from(k.thumbBytes.subarray(item.offset, item.offset + item.length))
}

async function glbKernel() {
  const k = await openKernel()
  if (typeof k.glb === 'function') return k
  unlinkSync(WASM_PATH)
  kernel = null
  await ensureWasm()
  return openKernel()
}

export async function downloadGlb(hash, target) {
  const k = await glbKernel()
  const bytes = Buffer.from(hash, 'utf8').subarray(0, k.input.length)
  k.input.set(bytes)
  const n = k.glb(bytes.length)
  if (n === 0) throw new Error('no model with hash ' + hash)
  const url = decoder.decode(k.json.subarray(0, n))
  return new Promise((done, fail) => {
    mkdirSync(dirname(target), { recursive: true })
    const temp = target + '.part'
    try { unlinkSync(temp) } catch {}
    const child = spawn('curl', ['-fL', '--http1.1', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '--connect-timeout', '20', '-K', '-', '-o', temp], { stdio: ['pipe', 'ignore', 'pipe'] })
    let last = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { last = (last + chunk).slice(-1000) })
    child.on('error', fail)
    child.on('exit', (code) => {
      if (code !== 0) { fail(new Error('glb download failed, curl exit ' + code + ': ' + last.split(url).join('<glb>').slice(-300))); return }
      renameSync(temp, target)
      done(statSync(target).size)
    })
    child.stdin.end('url = "' + url + '"\n')
  })
}

export { ROOT, WASM_PATH }
