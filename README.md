# Background Remover & Touch-Up

A background remover that runs entirely in your browser — no server, no API keys, no image ever leaves your machine — plus a manual touch-up brush for the spots the AI gets wrong.

## Features

- **One-click background removal**, powered by [`@imgly/background-removal`](https://github.com/imgly/background-removal-js), an ONNX/WASM segmentation model that runs client-side. The model downloads once (~40MB) and is cached by the browser after that.
- **Erase brush** — paint transparent, with adjustable size and edge softness (feathering).
- **Restore brush** — a "magic wand": touch a spot and it flood-fills outward through connected, similarly-colored original pixels. Touch a plain wall or sky and the whole area comes back in one stroke; it stops on its own at real edges. Tolerance is adjustable.
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
icons/                    # generated app icons (PNG + Windows .ico)
scripts/gen_icon.py        # regenerates icons/icon-*.png (no dependencies)
scripts/gen_ico.py         # packs those PNGs into icons/app.ico
```

## How the Restore "magic wand" works

Restore doesn't just copy pixels under the brush. On click/drag it seeds a small area at the brush position, then does a flood fill: each neighboring pixel in the *original* image is compared to its already-filled neighbor, and included if the color difference is within the Tolerance setting. This lets it walk through gradual shading (a wall, a sky) while still stopping at genuine edges (a difference too large to be the same surface).

## Credits

Background segmentation by [IMG.LY's `@imgly/background-removal`](https://github.com/imgly/background-removal-js) — check their repo for its license terms if you plan to use this beyond personal use.
