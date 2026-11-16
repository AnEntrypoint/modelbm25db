#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ensureWasm, info, listThumbs, search, thumbBytes, WASM_PATH } from './ensure-data.js'

const VIEW_INSTRUCTION = 'node modelbm25.js view "<query>" [-n 10] [--out <folder>]'
const FLAGS = new Set(['--json', '--urls', '--details', '--no-thumbs'])
const VALUED = new Set(['-n', '--out'])

function words(args) {
  return args.filter((arg, i) => !FLAGS.has(arg) && !VALUED.has(arg) && !VALUED.has(args[i - 1])).join(' ')
}

function option(args, name, fallback) {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}

async function searchCommand(query, limit, jsonOut, urlsOnly, details) {
  const found = await search(query, limit, false)
  const results = found.results
  if (urlsOnly) {
    for (const r of results) console.log(r.url)
  } else if (jsonOut) {
    console.log(JSON.stringify({ query, count: results.length, view: VIEW_INSTRUCTION, results }, null, 2))
  } else if (details) {
    console.log(`# ${query} — ${results.length} results`)
    for (const r of results) {
      const terms = r.terms.slice(0, 5).map((x) => x.term || x).join(', ')
      console.log(`${Math.abs(r.score).toFixed(4)}  ${r.hash}  ${terms}`)
      console.log(`        ${r.text.slice(0, 180)}`)
      console.log(`        ${r.url}`)
    }
    console.log('')
    console.log(VIEW_INSTRUCTION)
  } else {
    console.log(`# ${query} — ${results.length} ids`)
    for (const r of results) console.log(r.hash)
    console.log('')
    console.log(`Write their thumbnails to a folder with: ${VIEW_INSTRUCTION}`)
  }
}

async function viewCommand(query, limit, outOption) {
  const folder = resolve(outOption)
  const thumbsDir = join(folder, 'thumbs')
  mkdirSync(thumbsDir, { recursive: true })
  const found = await search(query, limit, true)
  const written = []
  for (const r of found.results) {
    const entry = { hash: r.hash, url: r.url, label: r.label, score: r.score, terms: r.terms, text: r.text, file: null }
    if (r.thumb) {
      entry.file = join('thumbs', r.hash + '.webp')
      writeFileSync(join(folder, entry.file), await thumbBytes({ offset: r.thumb.offset, length: r.thumb.length }))
    }
    written.push(entry)
  }
  writeFileSync(join(folder, 'results.json'), JSON.stringify({ query, count: written.length, results: written }, null, 2))
  console.log(JSON.stringify({ query, count: written.length, thumbs: written.filter((r) => r.file).length, folder, index: join(folder, 'results.json') }, null, 2))
}

async function extractCommand(folder, withThumbs) {
  const root = resolve(folder)
  const filesDir = join(root, 'files')
  const thumbsDir = join(root, 'thumbs')
  mkdirSync(filesDir, { recursive: true })
  mkdirSync(thumbsDir, { recursive: true })
  await ensureWasm()
  copyFileSync(WASM_PATH, join(filesDir, 'modelbm25.wasm'))
  const index = []
  if (withThumbs) {
    let next = 0
    const total = (await info()).thumbs
    while (next < total) {
      const page = await listThumbs(next, 1000)
      for (const item of page.items) {
        writeFileSync(join(thumbsDir, item.hash + '.webp'), await thumbBytes(item))
        index.push({ hash: item.hash, file: 'thumbs/' + item.hash + '.webp', offset: item.offset, length: item.length })
      }
      next = page.next
    }
  }
  writeFileSync(join(thumbsDir, 'index.json'), JSON.stringify(index))
  return { folder: root, wasm: join('files', 'modelbm25.wasm'), thumbs: { folder: 'thumbs', count: index.length, index: 'thumbs/index.json' } }
}

const [, , cmd = 'help', ...args] = process.argv
if (cmd === 'search') {
  const jsonOut = args.includes('--json')
  const urlsOnly = args.includes('--urls')
  const details = args.includes('--details')
  await searchCommand(words(args), Number(option(args, '-n', 10)), jsonOut, urlsOnly, details)
} else if (cmd === 'info' || cmd === 'verify') {
  console.log(JSON.stringify(await info(), null, 2))
} else if (cmd === 'fetch') {
  await ensureWasm()
  console.log('runtime assets ready')
} else if (cmd === 'view') {
  await viewCommand(words(args), Number(option(args, '-n', 10)), option(args, '--out', 'modelbm25-view'))
} else if (cmd === 'extract') {
  const folder = args.find((arg) => !arg.startsWith('--')) || 'modelbm25-extract'
  console.log(JSON.stringify(await extractCommand(folder, !args.includes('--no-thumbs')), null, 2))
} else {
  console.log(`usage: node modelbm25.js <search|info|view|fetch|extract> [args]

  search "blue ice dragon" -n 10 [--json|--urls|--details]
  info                  show document, term, posting and thumbnail counts
  view "blue ice dragon" -n 10 [--out folder]
                        write the matching models' thumbnails (thumbs/<hash>.webp)
                        and results.json into folder (default modelbm25-view)
  fetch                 download the wasm (also done automatically)
  extract [folder]      write the wasm, every thumbnail and index.json into a folder

  --urls                print direct CDN download URLs, one per line
  --details             print descriptions and CDN URLs
  --json                include the url, cdn_url and terms fields

Environment:
  MODELBM25_WASM        override path to modelbm25.wasm
  MODELBM25_WASM_URL    override the wasm download URL`)
}
