# Reading `./thumbs.pack`

`thumbs.pack` is one file in this directory containing every model's seven thumbnail views.
It replaces `thumbs/<xx>/<hash>_v<n>.webp` for gallery previews. No server, LanceDB, or
CLIP model is needed to read it — just this file and, if you want to display pixels, any
WebP decoder.

Run all commands below from `./` (the repo root, `/workspace/index/lance`).

```
./.venv/bin/python -c "from scripts.thumbpack import Pack; p=Pack('./thumbs.pack'); print(p.count, 'models', p.tile, 'px tiles')"
```

Current file: **38,969,785 bytes**, **47,572 models**, 7 views each, 64x64 px tiles in a
256x128 (4x2) WebP sheet. Verify with `ls -l ./thumbs.pack`.

---

## 1. File layout (byte-exact)

All integers are little-endian. Offsets are absolute from byte 0 of the file.

| Region | Start | Size | Contents |
| --- | ---: | ---: | --- |
| Header | 0 | 13 | `<5sBBBBI>` = magic `TIDX1`, `tile`, `views`, `grid_w`, `grid_h`, `count` |
| Record table | 13 | `38 * count` | `count` records of `<32sIH>`: raw 32-byte sha256, `uint32 offset`, `uint16 length` |
| Blobs | `13 + 38*count` | variable | concatenated standalone WebP files, in the same order as the table |

Use `HEADER.size` and `REC.size` rather than hardcoding these: `struct.Struct("<5sBBBBI").size == 13`
and `struct.Struct("<32sIH").size == 38`.

The table is **sorted by the raw 32-byte hash**, so lookup is a binary search (no index file).
Each blob is a complete WebP image of size `grid_w*tile` x `grid_h*tile` (currently 256x128).
View `n` is the tile at column `n % grid_w`, row `n // grid_w`. Tile 7 of the 4x2 grid is
unused white padding.

```
offset = HEADER.size + REC.size*count + sum(lengths of all previous records)
blob   = data[offset : offset + length]       # feed straight to an <img> or WebP decoder
```

`length` fits in `uint16` (observed max is under 1 KB); `offset` fits in `uint32` for this
~38 MB pack.

---

## 2. Fastest: use the bundled reader

`scripts/thumbpack.py` mmaps the file, so it does not load 38 MB into RAM, and does a binary
search over the table.

```bash
./.venv/bin/python - <<'PY'
from scripts.thumbpack import Pack
from PIL import Image
import io

pack = Pack("./thumbs.pack")          # mmap, lazy
h = pack._hash_at(0).hex()            # or any known 64-char sha256 hex

sheet_bytes = pack.blob(h)            # bytes of the 256x128 WebP, or None
view_bytes = pack.frame(h, 3)         # bytes of one 64x64 WebP, view 0..6

sheet = Image.open(io.BytesIO(sheet_bytes))
print("hash", h)
print("sheet", sheet.size, sheet.format, len(sheet_bytes), "bytes")
print("view3", Image.open(io.BytesIO(view_bytes)).size, len(view_bytes), "bytes")

# Crop a view yourself instead of calling frame():
tile, gw = pack.tile, pack.gw
v = 5
tile_img = sheet.crop(((v % gw) * tile, (v // gw) * tile,
                       (v % gw + 1) * tile, (v // gw + 1) * tile))
tile_img.save("./view5.png")
print("wrote ./view5.png", tile_img.size)
pack.close()
PY
```

`Pack` attributes: `tile`, `views`, `gw`, `gh`, `count`. Methods: `blob(hash_hex)` returns
`bytes | None`, `frame(hash_hex, view)` returns `bytes | None` (re-encoded 64x64 WebP),
`close()` releases the mmap. Unknown hashes and out-of-range views return `None`.

If you run from another directory, either add the repo to `sys.path` or import the module
directly:

```python
import sys; sys.path.insert(0, "/workspace/index/lance/scripts")
import thumbpack
p = thumbpack.Pack("/workspace/index/lance/thumbs.pack")
```

---

## 3. Zero-dependency lookup (standard library only)

Useful for Go/Rust/JS ports, or when Pillow is unavailable. This returns the raw WebP bytes;
writing them to a `.webp` file or returning them as `image/webp` is enough to display the
whole sprite sheet.

```bash
./.venv/bin/python - <<'PY'
import struct
from pathlib import Path

path = Path("./thumbs.pack")
with path.open("rb") as f:
    data = f.read()

HEADER = struct.Struct("<5sBBBBI")       # 13 bytes
REC = struct.Struct("<32sIH")            # 38 bytes
magic, tile, views, gw, gh, count = HEADER.unpack_from(data, 0)
assert magic == b"TIDX1", magic
table = HEADER.size
blobs = table + REC.size * count
print("header:", magic, tile, views, (gw, gh), count, "models, blobs start at", blobs)

# first record
h, off, length = REC.unpack_from(data, table)
Path("./first.webp").write_bytes(data[off:off + length])
print("first:", h.hex(), off, length, "-> ./first.webp")

# binary search without materializing all keys
def find(hash_hex):
    key = bytes.fromhex(hash_hex)
    lo, hi = 0, count
    while lo < hi:
        mid = (lo + hi) // 2
        row = data[table + mid * REC.size : table + mid * REC.size + 32]
        if row < key: lo = mid + 1
        else: hi = mid
    if lo == count: return None
    rh, off, length = REC.unpack_from(data, table + lo * REC.size)
    return data[off:off + length] if rh == key else None

known = h.hex()
print("lookup known:", len(find(known)), "bytes")
print("lookup missing:", find("0" * 64))
PY
```

---

## 4. Over HTTP (optional)

`./run.sh serve` exposes the same data when `./thumbs.pack` exists:

```bash
H=<64-char sha256 hex>
curl -o sheet.webp http://127.0.0.1:8710/thumb/pack/$H
curl -o view3.webp http://127.0.0.1:8710/thumb/pack/$H/3
```

- `/thumb/pack/<hash>` -> the 256x128 sprite sheet.
- `/thumb/pack/<hash>/<n>` -> one extracted 64x64 view (`n` in 0..6).
- Unknown hash -> 404. If `thumbs.pack` is absent, the old `/thumb/thumbs/<xx>/...` route
  still serves the original full-size WebP files and the gallery falls back to it.

---

## 5. In a browser / CSS sprite

The sheet is a plain WebP, so no custom decoder is needed. To show only view `n`, set the
image as a background with a 4x2 grid:

```css
/* Show view 3 at 128 px per tile. The sheet is 256x128, scaled to 512x256. */
.thumb { width: 128px; height: 128px; background-image: url(/thumb/pack/HASH);
         background-size: 512px 256px; }
.thumb.v3 { background-position: -384px 0; }  /* col 3*128, row 0 */
```

For view `n`: `background-position: -(n%4 * 128)px -(n//4 * 128)px`. Or just request
`/thumb/pack/<hash>/<n>` and use a normal `<img>`.

---

## 6. Rebuilding

```bash
./run.sh thumbpack                                     # full rebuild -> ./thumbs.pack
./run.sh thumbpack --limit 200 --output ./small.pack  # quick test pack
```

The builder (`scripts/thumbpack.py`) requires Pillow and reads `./thumbs/`; it writes to a
`.tmp` file and atomically renames it, so a failed build never corrupts an existing pack.

---

## Caveats

- These are **lossy 64 px previews** (WebP quality 10). Do not use them for CLIP embeddings,
  similarity search, or pixel-accurate comparison; `state/embeddings/` and `db/` use the
  original 448 px renders and are unchanged.
- The original `thumbs/` tree (1.93 GB) is still present. Deleting `./thumbs.pack` only
  disables the packed endpoint; deleting `thumbs/` would prevent rebuilding it.
- Animated WebP was benchmarked and is roughly 2x larger at the same quality, which is why
  sprite sheets are used.
