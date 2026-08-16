# Background Remover & Touch-Up

A background remover that runs entirely in your browser — no server, no API keys, no image ever leaves your machine, and no external services to depend on — plus a manual touch-up brush for the spots the AI gets wrong.

## Features

- **One-click background removal**, powered by [`@imgly/background-removal`](https://github.com/imgly/background-removal-js), an ONNX/WASM segmentation model that runs client-side. The library and the model weights (~95MB) are vendored directly in this repo under `vendor/` — nothing is fetched from a CDN at runtime, so this keeps working regardless of what happens to any third-party service, indefinitely.
- **Erase** and **Restore**, each with two modes:
  - **Brush** — paints exactly where you drag. Precise, freehand.
  - **Magic Wand** — click once and it flood-fills outward through connected, similarly-colored original pixels, stopping at outlines. Great for flat-color backgrounds; switch back to Brush for spots where the wand grabs more than you want (e.g. two same-colored areas that turn out to be touching).
- **Scroll-wheel zoom** with pan, anchored to the cursor, for pixel-level touch-ups.
- **Undo/redo**, reset-to-AI-result, and PNG export.
- Installable as a desktop app (see below) — no browser tabs or address bar.

## Running it

It's a static site (`index.html` / `style.css` / `app.js`) that needs to be served over HTTP — not opened directly as a `file://` URL — because ES modules and the WASM model require it.

```bash
python -m http.server 8000 --directory bg-remover
```

Then open `http://localhost:8000`.

### As a desktop app (Windows)

Double-click **`Launch BG Remover.vbs`**, or use the **Background Remover** shortcut it creates on your Desktop. It starts the local server in the background and opens the app in its own window (via Chrome/Edge `--app` mode — no tabs, no address bar).

To (re)create the desktop shortcut:

```powershell
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Background Remover.lnk")
$Shortcut.TargetPath = "$PWD\Launch BG Remover.vbs"
$Shortcut.WorkingDirectory = "$PWD"
$Shortcut.IconLocation = "$PWD\icons\app.ico"
$Shortcut.Save()
```

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
vendor/                   # vendored background-removal library + model weights (~95MB, no CDN dependency)
  background-removal.bundle.mjs   # the library, fully self-contained
  shims/                          # small Node.js API shims the library needs in-browser
  model-data/                     # ONNX model + ONNX Runtime WASM, split into chunk files
```

To change the icon artwork: replace `icons/cirno-source.png`, open `http://localhost:8000/scripts/build-icon.html`, download the three regenerated sizes into `icons/`, then run `python scripts/gen_ico.py` to rebuild `app.ico`.

### Why the model is vendored instead of loaded from a CDN

By default this library fetches its ONNX model and WASM runtime from IMG.LY's CDN on first use. That's fine for a quick demo, but it means the app's core feature stops working forever if that CDN ever goes away — not something you want in a tool you're keeping around long-term. Vendoring the exact files this app uses (CPU/wasm execution, the `isnet_fp16` model — the library's defaults) means the app has zero external runtime dependencies: it'll keep working exactly as-is no matter what happens on the internet.

If you ever want a smaller or larger model variant (`isnet_quint8` / `isnet`), or GPU (WebGPU) execution, you'd need to fetch those additional files the same way and add a `model`/`device` option to the `removeBackground()` call in `app.js`.

## How Magic Wand mode works

On click/drag it seeds a small area at the brush position, then flood-fills outward: each candidate pixel in the *original* image is compared against the exact color of the pixel you clicked (not against whatever neighbor reached it — comparing to the neighbor would let the fill "creep" across a gradual anti-aliased edge one small step at a time, even between two colors that are nothing alike overall). A pixel joins the fill only while its color stays within Tolerance of that original click point, so it stops precisely where the cumulative difference gets too large — the same approach real magic-wand tools use to avoid leaking past soft edges.

## Credits

Background segmentation by [IMG.LY's `@imgly/background-removal`](https://github.com/imgly/background-removal-js) (vendored in `vendor/`) — check their repo for its license terms if you plan to use this beyond personal use.

## License

See [LICENSE](LICENSE). You're welcome to download, run, and modify this for your own personal use — republishing/redistributing it (as-is or modified) or claiming authorship isn't permitted.
