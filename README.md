# 🚧 Cirno BR 🚧

*Cirno loves ts. 🤤*

A layer-based photo editor that runs entirely in your browser — no server, no API keys, no image ever leaves your machine, and no external services to depend on — built around cutting out subjects by hand (with AI help) and composing them, plus text, into one image.

## Features

- **Layers** — drag in as many photos as you want, each its own layer with its own undo history. Move, resize, reorder (drag its handle to send it forward/back), and delete each one independently. Everything flattens together on export.
- **Text layers** — add text anywhere in the stack, over or under your photos, with adjustable font, size, and color.
- **Box Select** — Paint-3D-"Magic Select"-style interactive AI segmentation: drag a box around an object, click to add a point / Shift+click to remove one to refine the selection, then Apply. Works on a fresh photo right away — no other step needed first. Drag from inside a selection to reposition it before applying, and check "Keep only this" to erase everything else on the canvas in the same step. Fully lazy — nothing is downloaded until you pick the Box Select tool.
- **Erase** and **Restore**, each with two modes:
  - **Brush** — paints exactly where you drag. Precise, freehand.
  - **Magic Wand** — click once and it flood-fills outward through connected, similarly-colored original pixels, stopping at outlines. Great for flat-color backgrounds; switch back to Brush for spots where the wand grabs more than you want (e.g. two same-colored areas that turn out to be touching).
- **Scroll-wheel zoom** with pan, anchored to the cursor, for pixel-level touch-ups.
- **Undo/redo** and PNG export (the full composited layer stack).
- Installable as a desktop app (see below) — no browser tabs or address bar.

## Running it

It's a static site (`index.html` / `style.css` / `app.js`) that needs to be served over HTTP — not opened directly as a `file://` URL — because ES modules and the WASM model require it.

```bash
python bg-remover/serve.py
```

Then open `http://localhost:8000`. (This uses `serve.py` rather than plain `python -m http.server` because it disables browser caching — useful if you're editing the app in place, since a stale cached copy of a JS file otherwise causes confusing errors after an update.)

### As a desktop app (Windows)

First time only: double-click **`Create Desktop Shortcut.vbs`**. That adds a **Background Remover** shortcut (with the Cirno icon) to your Desktop.

From then on, use that shortcut (or double-click **`Launch BG Remover.vbs`** directly, same thing) to open the app — it starts the local server in the background and opens the app in its own window (via Chrome/Edge `--app` mode — no tabs, no address bar).

(Run from inside the `bg-remover` folder.)

## Project structure

```
index.html              # layout
style.css                # styling
app.js                   # all app logic
manifest.json             # PWA manifest (installable, app icon/name)
Launch BG Remover.vbs      # starts the server + opens the app window
icons/                    # app icons (PNG + Windows .ico) and their source art
  cirno-source.png                # the artwork the icon is built from
  icon-32/192/512.png             # generated icon sizes
  app.ico                         # Windows shortcut icon, packed from the PNGs above
scripts/build-icon.html    # regenerates icon-*.png from icons/cirno-source.png (open via the local server)
scripts/gen_ico.py         # packs icon-*.png into icons/app.ico
vendor/                   # vendored Box Select model + runtime (no CDN dependency)
  sam/                            # SlimSAM ONNX weights, used by Box Select (lazy-loaded)
  transformers/                   # transformers.js, runs the Box Select model
  onnxruntime-web-sam/            # Box Select's own ONNX Runtime WASM build
```

To change the icon artwork: replace `icons/cirno-source.png`, open `http://localhost:8000/scripts/build-icon.html`, download the three regenerated sizes into `icons/`, then run `python scripts/gen_ico.py` to rebuild `app.ico`.

### Why the model is vendored instead of loaded from a CDN

Box Select's model ([SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform), run via [transformers.js](https://github.com/huggingface/transformers.js)) is vendored directly in this repo instead of fetched from a CDN, so the app keeps working exactly as-is no matter what happens to any third-party service — zero external runtime dependencies. It's quantized (~14MB of weights) and lazy: nothing is downloaded until you actually pick the Box Select tool, shown with a sidebar progress bar.

## How Magic Wand mode works

On click/drag it seeds a small area at the brush position, then flood-fills outward: each candidate pixel in the *original* image is compared against the exact color of the pixel you clicked (not against whatever neighbor reached it — comparing to the neighbor would let the fill "creep" across a gradual anti-aliased edge one small step at a time, even between two colors that are nothing alike overall). A pixel joins the fill only while its color stays within Tolerance of that original click point, so it stops precisely where the cumulative difference gets too large — the same approach real magic-wand tools use to avoid leaking past soft edges.

## Credits

Object segmentation by [SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform) via [transformers.js](https://github.com/huggingface/transformers.js) (vendored in `vendor/`).


Btw if the app doesnt work for SOME REASON.... paste this in ur browser lmfao http://localhost:8000/

## License

See [LICENSE](LICENSE). You're welcome to download, run, and modify this for your own personal use — republishing/redistributing it (as-is or modified) or claiming authorship isn't permitted.
