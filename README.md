# modelbm25db

Read-only BM25 search and thumbnail export for **47,572** 3D model descriptions derived from the public CLIP Interrogator phrase corpus and CLIP vectors.

The whole runtime is one WebAssembly module, `modelbm25.wasm`: the search index, the model descriptions, the 64x64 WebP thumbnails and the BM25 ranking all live inside it. The JS is a thin host that downloads the module, runs it, and writes what it returns. There is no SQLite, no Brotli and no server at runtime. The only runtime npm dependency is `jz`, for the JS-to-wasm bridge.

## Run from GitHub with npx

```bash
npx github:AnEntrypoint/modelbm25db search "blue ice dragon" -n 10
npx github:AnEntrypoint/modelbm25db info
npx github:AnEntrypoint/modelbm25db view "blue ice dragon" -n 10 --out ./blue-ice
```

## Install globally from GitHub

```bash
npm install -g github:AnEntrypoint/modelbm25db
modelbm25 search "blue ice dragon" -n 10
modelbm25 info
modelbm25 view "blue ice dragon" -n 10 --out ./blue-ice
```

## First-run data

On first use the CLI downloads `modelbm25.wasm` (about 94 MB) from the `v1.0.0-data` release into the package directory, with progress on stderr. Later runs reuse it. `fetch` downloads it without running a command.

```bash
modelbm25 fetch
```

## Search

```bash
modelbm25 search "blue ice dragon" -n 10
modelbm25 search "blue ice dragon" -n 10 --urls
modelbm25 search "blue ice dragon" -n 10 --details
modelbm25 search "blue ice dragon" -n 10 --json
```

Default output lists the matching model hashes, then the view instruction. `--urls` prints direct CDN links, `--details` prints scores, top terms, descriptions and links, and `--json` prints `hash`, `url`, `cdn_url`, `label`, `score`, `terms` and `text` for each result.

Scores are BM25 with k1 = 1.2 and b = 0.75 and are negative, lower is better, as with SQLite FTS5's `bm25()`. Tokens are lowercase ASCII letters and digits with light suffix stemming (`-s`, `-es` via `ies`, `-ed`, `-ing`). Against the previous SQLite FTS5 (porter) ranking on eight sample queries the top-10 hashes overlapped 96% of the time and the top result matched every time.

## View: thumbnails for a request

`view` runs a search and writes the matching models' thumbnails into a folder. It does not start a server or open a port.

```bash
modelbm25 view "blue ice dragon" -n 10 --out ./blue-ice
```

Output folder layout:

- `thumbs/<64-hex-hash>.webp`: one 64x64 WebP per matched model, copied out of the wasm
- `results.json`: `query`, `count` and `results`; each result has `hash`, `url`, `label`, `score`, `terms`, `text` and `file` (the thumbnail path, or `null` if it was not written)

`--out` defaults to `modelbm25-view` in the current directory. `-n` sets how many models to write (default 10). The command prints a JSON summary with the folder, the match count, the thumbnail count and the path of `results.json`.

## Extract everything

```bash
modelbm25 extract ./modelbm25-extract
```

writes `files/modelbm25.wasm`, one WebP per model at `thumbs/<hash>.webp`, and `thumbs/index.json` (hash, file, offset and length of each thumbnail inside the wasm). Pass `--no-thumbs` to write only the wasm.

## Override locations

```bash
MODELBM25_WASM=/path/to/modelbm25.wasm
MODELBM25_WASM_URL=https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0-data/modelbm25.wasm
MODELBM25_ROOT=/path/to/folder/holding/modelbm25.wasm
```

## Requirements

Node **24+** and the `jz` package (installed with the CLI).

## How the wasm is laid out

`modelbm25.wasm` is a compiled JZ kernel plus one custom section, `modelbm25`, that holds the payload:

- header: magic, version, document, term, posting and thumbnail counts, total token count, and the offset of every section
- document offsets and texts: per model, `label`, `description` and the `terms` JSON, separated by unit separators
- document lengths: token count per description, for BM25
- term dictionary: sorted by two 32-bit hashes of each stemmed term, with the start and count of its postings
- postings: document index (u32) and term frequency (u16) for every term occurrence
- the thumbnail pack: the 13-byte header, 47,572 index records (hash, offset, length) and the WebP blobs

The kernel exports `search`, `listThumbs`, `info` and the typed arrays it reads and writes (`blob`, `input`, `json`, `thumbBytes`). It ranks, builds the JSON and copies the thumbnails itself. The JS host instantiates it, copies the payload into `blob` once, and decodes `json` and `thumbBytes`.

## Source and rebuild

Readable source (`src/*.src.js`, `src/wasm/kernel.js`) and the build script (`scripts/build-wasm.mjs`) are gitignored, and so are `thumbs.pack` and `modelbm25.sqlite.br`, which are the build inputs. The published JS (`modelbm25.js`, `ensure-data.js`) is generated from `src/` with:

```bash
npm install
node scripts/build-obfuscated.mjs
```

Rebuild the wasm from the local inputs and upload it to the data release:

```bash
npm run wasm
gh release upload v1.0.0-data modelbm25.wasm --clobber --repo AnEntrypoint/modelbm25db
```

The package ships only `modelbm25.js`, `ensure-data.js`, this README and the license.
