# modelbm25db

Read-only BM25 search plus thumbnail export for **47,572** 3D model descriptions derived from the public CLIP Interrogator phrase corpus and CLIP vectors.

Uses Node 24's built-in `node:sqlite`, FTS5 `bm25()`, and Brotli. No runtime npm dependencies.

## Run from GitHub with npx

```bash
npx github:AnEntrypoint/modelbm25db search "blue ice dragon" -n 10
npx github:AnEntrypoint/modelbm25db info
npx github:AnEntrypoint/modelbm25db view "blue ice dragon" -n 10 --out ./blue-ice
```

If your npm client blocks or delays GitHub package preparation, use the verified global install form below; it runs the same `modelbm25` CLI.

## Install globally from GitHub

```bash
npm install -g github:AnEntrypoint/modelbm25db
modelbm25 search "blue ice dragon" -n 10
modelbm25 info
modelbm25 view "blue ice dragon" -n 10 --out ./blue-ice
```

## First-run data

The git/npm package is tiny and has no `postinstall` and no runtime npm dependencies. On first use it downloads `modelbm25.wasm` from the `v1.0.0-data` release; the wasm supplies the file/thumb manifest and links, and the host then lazily downloads the read-only assets into the installed package directory with loud progress on stderr. Search/info need only the 11.7 MB database; `view`/`fetch` also download the 39 MB thumbnail pack:

- `modelbm25.sqlite.br` — 11.7 MB Brotli-compressed SQLite FTS5 database
- `thumbs.pack` — 39 MB compressed WebP thumbnail sheets

The CLI checks file sizes and skips downloads if they are already present. Installation stays quick; downloads happen only when a command needs the data. To prefetch manually, or to materialize everything into a folder:

```bash
modelbm25 fetch
node ensure-data.js
node modelbm25.js extract ./modelbm25-extract
```

`extract` writes `files/modelbm25.sqlite.br`, `files/thumbs.pack`, and one WebP per model at `thumbs/<hash>.webp` plus `thumbs/index.json`; the file names, release links and thumb offsets come from the wasm.

## View: thumbnails for a request

`view` runs a search and writes the matching models' thumbnails into a folder. It does not start a server or open a port.

```bash
modelbm25 view "blue ice dragon" -n 10 --out ./blue-ice
```

Output folder layout:

- `thumbs/<64-hex-hash>.webp` — one 64x64 WebP per matched model, cut from `thumbs.pack`
- `results.json` — `query`, `count`, and `results`; each result has `hash`, `url` (direct CDN link), `label`, `score`, `terms`, `text` (description) and `file` (the thumbnail path, or `null` if the pack has no record for it)

`--out` defaults to `modelbm25-view` in the current directory. `-n` sets how many models to write (default 10). The command prints a JSON summary with the folder, the match count, the thumbnail count, and the path of `results.json`.

## Override asset locations

```bash
MODELBM25_DB=/path/to/modelbm25.sqlite.br
MODELBM25_ROOT=/path/to/folder/holding/runtime/files
MODELBM25_WASM=/path/to/modelbm25.wasm
MODELBM25_WASM_URL=https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0-data/modelbm25.wasm
```

## Search output

Default search output returns model ids/hashes that can be written out with `view`, plus the instruction:

```text
# <query> — N ids
<64-hex model hash>
...
Write their thumbnails to a folder with: node modelbm25.js view "<query>" [-n 10] [--out <folder>]
```

Direct CDN links only (opt-in):

```bash
modelbm25 search "blue ice dragon" -n 10 --urls
modelbm25 search "blue ice dragon" -n 10 --details
```

JSON output includes `url`, `cdn_url`, and the view instruction:

```bash
modelbm25 search "blue ice dragon" -n 10 --json
```

## Requirements

Node **24+** with built-in `node:sqlite`, SQLite FTS5 / `bm25()`, and Brotli decompression.


## Source and distributed JS

Readable source lives in `src/*.src.js` and is intentionally gitignored. `scripts/build-obfuscated.mjs` generates the published minified/mangled root files:

```bash
node scripts/build-obfuscated.mjs
```

The wasm's rebuild inputs are also gitignored: `src/wasm/kernel.js`, `scripts/build-wasm.mjs`, the generated `src/wasm/data.generated.js`, and `builder/` with the pinned JZ compiler. `npm run wasm` rebuilds `modelbm25.wasm` from the local `thumbs.pack` and `modelbm25.sqlite.br`; upload it to the data release with `gh release upload v1.0.0-data modelbm25.wasm --clobber`. The published JS only loads the wasm from the release.

The npm/GitHub package ships only the generated `modelbm25.js` and `ensure-data.js`.
