# modelbm25db

Read-only BM25 search plus a local thumbnail viewer for **47,572** 3D model descriptions derived from the public CLIP Interrogator phrase corpus and CLIP vectors.

It is a Node CLI/package with no runtime dependency on Python, npm packages, or a database server. It uses Node 24's built-in `node:sqlite`, FTS5 `bm25()`, and Brotli.

## Install / run from GitHub

Run directly with `npx`:

```bash
npx github:AnEntrypoint/modelbm25db search "blue ice dragon" -n 10
npx github:AnEntrypoint/modelbm25db info
npx github:AnEntrypoint/modelbm25db view 8713
```

Install globally with npm:

```bash
npm install -g github:AnEntrypoint/modelbm25db
modelbm25 search "blue ice dragon" -n 10
modelbm25 info
modelbm25 view 8713
```

Then open:

**http://127.0.0.1:8713/**

Use a different port:

```bash
modelbm25 view 9000
# or
npx github:AnEntrypoint/modelbm25db view 9000
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

`modelbm25 view [port]` starts a local server:

- `/` — search page with thumbnails
- `/api/search?q=...&n=30` — BM25 results and direct CDN URLs
- `/api/info` — database and thumbnail counts
- `/thumb/<64-hex-hash>.webp` — on-demand WebP thumbnail from `thumbs.pack`

The viewer reads thumbnails directly from `thumbs.pack`; it does not unpack or write them.

## Runtime files kept in the package

- `modelbm25.js` — CLI and `view` launcher
- `viewer.js` — local webpage/server
- `modelbm25.sqlite.br` — Brotli-compressed SQLite FTS5 database, decompressed into memory
- `thumbs.pack` — compressed WebP thumbnail sheets
- `README.md` — this file

Override data paths with:

```bash
MODELBM25_DB=/path/to/modelbm25.sqlite.br
MODELBM25_THUMBS=/path/to/thumbs.pack
```

## Requirements

Node **24+** with:

- built-in `node:sqlite`
- SQLite FTS5 / `bm25()`
- built-in Brotli decompression

No install-time build step and no runtime npm dependencies.
