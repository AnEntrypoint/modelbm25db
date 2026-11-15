# modelbm25db

Read-only BM25 search plus a local thumbnail viewer for **47,572** 3D model descriptions derived from the public CLIP Interrogator phrase corpus and CLIP vectors.

Uses Node 24's built-in `node:sqlite`, FTS5 `bm25()`, and Brotli. No runtime npm dependencies.

## Run from GitHub with npx

```bash
npx github:AnEntrypoint/modelbm25db search "blue ice dragon" -n 10
npx github:AnEntrypoint/modelbm25db info
npx github:AnEntrypoint/modelbm25db view 8713
```

Open the viewer at **http://127.0.0.1:8713/**.

## Install globally from GitHub

```bash
npm install -g github:AnEntrypoint/modelbm25db
modelbm25 search "blue ice dragon" -n 10
modelbm25 info
modelbm25 view 8713
```

Use a different port:

```bash
modelbm25 view 9000
npx github:AnEntrypoint/modelbm25db view 9000
```

## First-run data

The git/npm package is tiny. On first use it downloads two read-only assets from the `v1.0.0` GitHub Release into the installed package directory:

- `modelbm25.sqlite.br` — 11.7 MB Brotli-compressed SQLite FTS5 database
- `thumbs.pack` — 39 MB compressed WebP thumbnail sheets

The CLI checks file sizes and skips downloads if they are already present. To prefetch manually:

```bash
modelbm25 fetch
# or
node ensure-data.js
```

Override asset locations:

```bash
MODELBM25_DB=/path/to/modelbm25.sqlite.br
MODELBM25_THUMBS=/path/to/thumbs.pack
```

Override the release URL prefix:

```bash
MODELBM25_RELEASE=https://github.com/AnEntrypoint/modelbm25db/releases/download/v1.0.0
```

## Search output

Normal search output includes direct CDN download links and ends with:

```text
To view thumbnails locally: node modelbm25.js view 8713, then open http://127.0.0.1:8713/
```

Direct CDN links only:

```bash
modelbm25 search "blue ice dragon" -n 10 --urls
```

JSON output includes `url`, `cdn_url`, and the viewer instruction:

```bash
modelbm25 search "blue ice dragon" -n 10 --json
```

## Viewer endpoints

`modelbm25 view [port]` starts:

- `/` — search page with thumbnails
- `/api/search?q=...&n=30` — BM25 results and direct CDN URLs
- `/api/info` — database and thumbnail counts
- `/thumb/<64-hex-hash>.webp` — on-demand WebP from `thumbs.pack`

## Requirements

Node **24+** with built-in `node:sqlite`, SQLite FTS5 / `bm25()`, and Brotli decompression.
