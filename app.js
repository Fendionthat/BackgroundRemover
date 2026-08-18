import { removeBackground } from "./vendor/background-removal.bundle.mjs";

const MAX_DIM = 1600;
const UNDO_LIMIT = 15;

const fileInput = document.getElementById("fileInput");
const removeBgBtn = document.getElementById("removeBgBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const toolPanel = document.getElementById("toolPanel");
const exportPanel = document.getElementById("exportPanel");
const boxSelectPanel = document.getElementById("boxSelectPanel");
const boxSelectToolBtn = document.getElementById("boxSelectToolBtn");
const samProgressWrap = document.getElementById("samProgressWrap");
const samProgressBar = document.getElementById("samProgressBar");
const boxSelectActions = document.getElementById("boxSelectActions");
const samApplyBtn = document.getElementById("samApplyBtn");
const samCancelBtn = document.getElementById("samCancelBtn");
const samOverlay = document.getElementById("samOverlay");
const samCtx = samOverlay.getContext("2d");
const eraseToolBtn = document.getElementById("eraseToolBtn");
const restoreToolBtn = document.getElementById("restoreToolBtn");
const brushModeBtn = document.getElementById("brushModeBtn");
const magicModeBtn = document.getElementById("magicModeBtn");
const toolHint = document.getElementById("toolHint");
const softnessRow = document.getElementById("softnessRow");
const toleranceRow = document.getElementById("toleranceRow");
const brushSizeInput = document.getElementById("brushSize");
const brushSizeVal = document.getElementById("brushSizeVal");
const softnessInput = document.getElementById("softness");
const softnessVal = document.getElementById("softnessVal");
const toleranceInput = document.getElementById("tolerance");
const toleranceVal = document.getElementById("toleranceVal");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");
const downloadBtn = document.getElementById("downloadBtn");
const newImageBtn = document.getElementById("newImageBtn");
const canvasViewport = document.getElementById("canvasViewport");
const canvasWrap = document.getElementById("canvasWrap");
const zoomIndicator = document.getElementById("zoomIndicator");
const dropzone = document.getElementById("dropzone");
const workingCanvas = document.getElementById("workingCanvas");
const brushCursor = document.getElementById("brushCursor");
const statusEl = document.getElementById("status");

const ctxWorking = workingCanvas.getContext("2d", { willReadFrequently: true });

const originalCanvas = document.createElement("canvas");
const ctxOriginal = originalCanvas.getContext("2d", { willReadFrequently: true });

let currentTool = "erase";
let magicMode = false;
let brushSize = 40;
let softness = 0.5;
let tolerance = 20; // matches the tolerance slider's default (8%) of 255
let isDrawing = false;
let lastPoint = null;
let undoStack = [];
let redoStack = [];
let baselineImageData = null;
let hasImage = false;
let hasResult = false;

let originalImageData = null;
let fillVisited = null;
let fillGen = 0;
let strokeImageData = null;

let activeTool = "touchup"; // "touchup" | "boxSelect"
let samModule = null; // { SamModel, AutoProcessor, RawImage, Tensor, env }
let samModel = null;
let samProcessor = null;
let samLoadingPromise = null;
let samImageVersion = 0;
let samEmbeddingsVersion = -1;
let samImageProcessed = null;
let samImageEmbeddings = null;
let samBox = null; // {x0,y0,x1,y1} in original-image pixel space
let samPoints = []; // [{x, y, label}]
let samMask = null; // Uint8Array, one byte per pixel, original-image resolution
let samDragStart = null;
let samDragging = false;
let samMoved = false;
let samBusy = false;
let samPromptQueued = false;

let zoom = 1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

const brushCanvas = document.createElement("canvas");
const brushCtx = brushCanvas.getContext("2d");

function setStatus(text) {
  statusEl.textContent = text;
}

function resizeBrushCanvas() {
  const size = Math.ceil(brushSize * 2);
  brushCanvas.width = size;
  brushCanvas.height = size;
  const r = brushSize;
  const hardnessStop = Math.max(0, Math.min(1, 1 - softness * 0.9));
  brushCtx.clearRect(0, 0, size, size);
  const g = brushCtx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(hardnessStop, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  brushCtx.fillStyle = g;
  brushCtx.beginPath();
  brushCtx.arc(r, r, r, 0, Math.PI * 2);
  brushCtx.fill();
}
resizeBrushCanvas();

// ---------- Image loading ----------

async function loadImageFile(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  originalCanvas.width = width;
  originalCanvas.height = height;
  ctxOriginal.clearRect(0, 0, width, height);
  ctxOriginal.drawImage(bitmap, 0, 0, width, height);
  originalImageData = ctxOriginal.getImageData(0, 0, width, height);
  fillVisited = new Int32Array(width * height).fill(-1);
  fillGen = 0;

  workingCanvas.width = width;
  workingCanvas.height = height;
  ctxWorking.clearRect(0, 0, width, height);
  ctxWorking.drawImage(bitmap, 0, 0, width, height);

  hasImage = true;
  hasResult = false;
  undoStack = [];
  redoStack = [];
  baselineImageData = null;
  toolPanel.hidden = true;
  exportPanel.hidden = true;
  boxSelectPanel.hidden = true;
  if (activeTool === "boxSelect") deactivateBoxSelect();
  samImageVersion++;
  dropzone.style.display = "none";
  removeBgBtn.disabled = false;
  updateUndoRedoButtons();
  resetZoom();
  setStatus(`Loaded image (${width}×${height}). Click "Remove Background" when ready.`);
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadImageFile(file);
});

["dragenter", "dragover"].forEach((evt) =>
  canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault();
    canvasWrap.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  canvasWrap.addEventListener(evt, (e) => {
    e.preventDefault();
    canvasWrap.classList.remove("drag-over");
  })
);
canvasWrap.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) loadImageFile(file);
});

// ---------- Background removal ----------

removeBgBtn.addEventListener("click", async () => {
  if (!hasImage) return;
  removeBgBtn.disabled = true;
  fileInput.disabled = true;
  progressWrap.hidden = false;
  progressBar.style.width = "0%";
  setStatus("Downloading model & removing background… (first run may take a bit)");

  try {
    const sourceBlob = await new Promise((resolve) =>
      originalCanvas.toBlob(resolve, "image/png")
    );

    const resultBlob = await removeBackground(sourceBlob, {
      publicPath: new URL("./vendor/model-data/", import.meta.url).toString(),
      // "isnet" is the full-precision model (higher quality than the
      // library's smaller/faster default, "isnet_fp16"). Only "isnet" is
      // vendored in vendor/model-data/ -- switching models means fetching
      // that model's chunks too (see the README).
      model: "isnet",
      progress: (key, current, total) => {
        if (total) {
          const pct = Math.round((current / total) * 100);
          progressBar.style.width = pct + "%";
        }
      },
    });

    const bitmap = await createImageBitmap(resultBlob);
    ctxWorking.clearRect(0, 0, workingCanvas.width, workingCanvas.height);
    ctxWorking.drawImage(bitmap, 0, 0, workingCanvas.width, workingCanvas.height);

    baselineImageData = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
    undoStack = [];
    redoStack = [];
    hasResult = true;
    toolPanel.hidden = false;
    exportPanel.hidden = false;
    boxSelectPanel.hidden = false;
    updateUndoRedoButtons();
    applyZoom();
    setStatus('Background removed. Pick Erase or Restore, then Brush (precise) or Magic Wand (click a whole same-color area) below.');
  } catch (err) {
    console.error(err);
    setStatus("Something went wrong removing the background: " + err.message);
  } finally {
    removeBgBtn.disabled = false;
    fileInput.disabled = false;
    progressWrap.hidden = true;
  }
});

// ---------- Tools ----------

const TOOL_HINTS = {
  "erase-brush": "Erase paints transparent wherever you drag — precise, freehand cleanup.",
  "erase-magic": "Magic Erase: click a background area to remove the whole connected same-color region. Stops at outlines, so matching colors on the subject (like white-on-white) are safe — but connected same-color areas with no outline between them (e.g. a skirt and shirt of the same white) will go together. Switch to Brush for precise control.",
  "restore-brush": "Restore paints back the original image wherever you drag — precise, freehand.",
  "restore-magic": "Magic Restore: click an erased area to bring back the whole connected same-color region from the original image.",
};

function updateToolUI() {
  eraseToolBtn.classList.toggle("active", currentTool === "erase");
  restoreToolBtn.classList.toggle("active", currentTool === "restore");
  brushModeBtn.classList.toggle("active", !magicMode);
  magicModeBtn.classList.toggle("active", magicMode);
  softnessRow.hidden = magicMode;
  softnessInput.hidden = magicMode;
  toleranceRow.hidden = !magicMode;
  toleranceInput.hidden = !magicMode;
  toolHint.textContent = TOOL_HINTS[`${currentTool}-${magicMode ? "magic" : "brush"}`];
}

function setTool(tool) {
  currentTool = tool;
  updateToolUI();
}
function setMode(magic) {
  magicMode = magic;
  updateToolUI();
}
eraseToolBtn.addEventListener("click", () => setTool("erase"));
restoreToolBtn.addEventListener("click", () => setTool("restore"));
brushModeBtn.addEventListener("click", () => setMode(false));
magicModeBtn.addEventListener("click", () => setMode(true));
updateToolUI();

brushSizeInput.addEventListener("input", () => {
  brushSize = Number(brushSizeInput.value);
  brushSizeVal.textContent = brushSize;
  resizeBrushCanvas();
  updateCursorSize();
});

softnessInput.addEventListener("input", () => {
  softness = Number(softnessInput.value) / 100;
  softnessVal.textContent = softnessInput.value;
  resizeBrushCanvas();
});

toleranceInput.addEventListener("input", () => {
  tolerance = Math.round((Number(toleranceInput.value) / 100) * 255);
  toleranceVal.textContent = toleranceInput.value;
});

// ---------- Drawing ----------

function getCanvasPoint(evt) {
  const rect = workingCanvas.getBoundingClientRect();
  const scaleX = workingCanvas.width / rect.width;
  const scaleY = workingCanvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
    clientX: evt.clientX,
    clientY: evt.clientY,
  };
}

// Flood-fills outward from a click point through pixels of the *original*
// image that are connected and color-similar *to the clicked pixel* (every
// candidate is compared against that one fixed reference color, not against
// whatever neighbor reached it — comparing to the neighbor instead would let
// the fill "creep" across a gradual anti-aliased edge one small step at a
// time, even between two colors that are nothing alike overall, e.g. black
// hair bleeding into a skin-tone face through the soft edge between them).
// `erase` selects the action on each matched pixel: true clears it to
// transparent, false restores it from the original image. Returns the
// touched bounding box (for a cheap partial putImageData), or null if
// nothing matched.
function floodFillStamp(cx, cy, erase) {
  if (!strokeImageData || !originalImageData) return null;
  const w = workingCanvas.width;
  const h = workingCanvas.height;
  const buf = strokeImageData.data;
  const orig = originalImageData.data;
  const r = brushSize;
  const tol = tolerance;

  const seedX = Math.min(w - 1, Math.max(0, Math.round(cx)));
  const seedY = Math.min(h - 1, Math.max(0, Math.round(cy)));
  const seedP = (seedY * w + seedX) * 4;
  const refR = orig[seedP], refG = orig[seedP + 1], refB = orig[seedP + 2];
  const matches = (p) =>
    Math.max(Math.abs(orig[p] - refR), Math.abs(orig[p + 1] - refG), Math.abs(orig[p + 2] - refB)) <= tol;

  fillGen++;
  const gen = fillGen;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const stackX = [];
  const stackY = [];
  const rSq = r * r;

  const seedMinX = Math.max(0, Math.floor(cx - r));
  const seedMaxX = Math.min(w - 1, Math.ceil(cx + r));
  const seedMinY = Math.max(0, Math.floor(cy - r));
  const seedMaxY = Math.min(h - 1, Math.ceil(cy + r));

  const copyPixel = erase
    ? (idx) => {
        const p = idx * 4;
        buf[p] = 0;
        buf[p + 1] = 0;
        buf[p + 2] = 0;
        buf[p + 3] = 0;
      }
    : (idx) => {
        const p = idx * 4;
        buf[p] = orig[p];
        buf[p + 1] = orig[p + 1];
        buf[p + 2] = orig[p + 2];
        buf[p + 3] = orig[p + 3];
      };

  for (let y = seedMinY; y <= seedMaxY; y++) {
    for (let x = seedMinX; x <= seedMaxX; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > rSq) continue;
      const idx = y * w + x;
      if (fillVisited[idx] === gen) continue;
      fillVisited[idx] = gen;
      if (!matches(idx * 4)) continue;
      copyPixel(idx);
      stackX.push(x);
      stackY.push(y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  while (stackX.length) {
    const x = stackX.pop();
    const y = stackY.pop();
    const idx = y * w + x;

    // 4-connected neighbors, inlined for hot-loop performance
    if (x > 0) {
      const nidx = idx - 1;
      if (fillVisited[nidx] !== gen) {
        fillVisited[nidx] = gen;
        if (matches(nidx * 4)) {
          copyPixel(nidx);
          stackX.push(x - 1); stackY.push(y);
          if (x - 1 < minX) minX = x - 1;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (x < w - 1) {
      const nidx = idx + 1;
      if (fillVisited[nidx] !== gen) {
        fillVisited[nidx] = gen;
        if (matches(nidx * 4)) {
          copyPixel(nidx);
          stackX.push(x + 1); stackY.push(y);
          if (x + 1 > maxX) maxX = x + 1;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (y > 0) {
      const nidx = idx - w;
      if (fillVisited[nidx] !== gen) {
        fillVisited[nidx] = gen;
        if (matches(nidx * 4)) {
          copyPixel(nidx);
          stackX.push(x); stackY.push(y - 1);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y - 1 < minY) minY = y - 1;
        }
      }
    }
    if (y < h - 1) {
      const nidx = idx + w;
      if (fillVisited[nidx] !== gen) {
        fillVisited[nidx] = gen;
        if (matches(nidx * 4)) {
          copyPixel(nidx);
          stackX.push(x); stackY.push(y + 1);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y + 1 > maxY) maxY = y + 1;
        }
      }
    }
  }

  if (minX > maxX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function stampBrush(x, y) {
  const r = brushSize;
  if (magicMode) {
    const dirty = floodFillStamp(Math.round(x), Math.round(y), currentTool === "erase");
    if (dirty) {
      ctxWorking.putImageData(strokeImageData, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
    }
  } else if (currentTool === "erase") {
    ctxWorking.globalCompositeOperation = "destination-out";
    ctxWorking.drawImage(brushCanvas, x - r, y - r);
    ctxWorking.globalCompositeOperation = "source-over";
  } else {
    // brush restore: feathered copy of the original image within the brush circle
    const size = Math.ceil(r * 2);
    const tmp = document.createElement("canvas");
    tmp.width = size;
    tmp.height = size;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(originalCanvas, x - r, y - r, size, size, 0, 0, size, size);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(brushCanvas, 0, 0);
    ctxWorking.drawImage(tmp, x - r, y - r);
  }
}

function strokeTo(point) {
  if (!lastPoint) {
    stampBrush(point.x, point.y);
  } else {
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(2, brushSize / 4);
    const steps = Math.max(1, Math.floor(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      stampBrush(lastPoint.x + dx * t, lastPoint.y + dy * t);
    }
  }
  lastPoint = point;
}

function pushUndo() {
  const snapshot = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

workingCanvas.addEventListener("pointerdown", (e) => {
  if (activeTool === "boxSelect") {
    if (!hasResult) return;
    try {
      workingCanvas.setPointerCapture(e.pointerId);
    } catch {
      // some input sources (synthetic events, certain stylus drivers) don't support capture; drawing still works without it
    }
    samDragStart = getCanvasPoint(e);
    samDragging = true;
    samMoved = false;
    return;
  }
  if (!hasResult) return;
  try {
    workingCanvas.setPointerCapture(e.pointerId);
  } catch {
    // some input sources (synthetic events, certain stylus drivers) don't support capture; drawing still works without it
  }
  pushUndo();
  isDrawing = true;
  lastPoint = null;
  if (magicMode) {
    strokeImageData = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  }
  const p = getCanvasPoint(e);
  strokeTo(p);
});

let lastPointerEvent = null;

workingCanvas.addEventListener("pointermove", (e) => {
  lastPointerEvent = e;
  if (activeTool === "boxSelect") {
    if (samDragging) {
      const p = getCanvasPoint(e);
      if (Math.abs(p.x - samDragStart.x) > 3 || Math.abs(p.y - samDragStart.y) > 3) samMoved = true;
      samBox = normalizeBox(samDragStart, p);
      drawSamOverlay();
    }
    return;
  }
  updateCursorPosition(e);
  if (!isDrawing) return;
  const p = getCanvasPoint(e);
  strokeTo(p);
});

canvasWrap.addEventListener("scroll", () => {
  if (lastPointerEvent) updateCursorPosition(lastPointerEvent);
  if (activeTool === "boxSelect") positionSamOverlay();
});

window.addEventListener("pointerup", (e) => {
  if (activeTool === "boxSelect") {
    if (samDragging) {
      samDragging = false;
      if (samMoved && samBox) {
        samPoints = [];
        runSamPrompt();
      } else if (!samMoved && samBox) {
        const p = getCanvasPoint(e);
        samPoints.push({ x: p.x, y: p.y, label: e.shiftKey ? 0 : 1 });
        runSamPrompt();
      }
    }
    return;
  }
  isDrawing = false;
  lastPoint = null;
  strokeImageData = null;
});

canvasWrap.addEventListener("pointerenter", () => {
  if (hasResult && activeTool !== "boxSelect") brushCursor.hidden = false;
});
canvasWrap.addEventListener("pointerleave", () => {
  brushCursor.hidden = true;
});

function updateCursorPosition(e) {
  // brushCursor is absolutely positioned inside the *scrollable* canvasWrap, so its
  // left/top are relative to the scrolled content origin, not the visible viewport —
  // the current scroll offset has to be added back in or the ring drifts while panned/zoomed.
  const wrapRect = canvasWrap.getBoundingClientRect();
  brushCursor.style.left = e.clientX - wrapRect.left + canvasWrap.scrollLeft + "px";
  brushCursor.style.top = e.clientY - wrapRect.top + canvasWrap.scrollTop + "px";
}

function updateCursorSize() {
  const rect = workingCanvas.getBoundingClientRect();
  const displayScale = rect.width / workingCanvas.width || 1;
  const displaySize = brushSize * 2 * displayScale;
  brushCursor.style.width = displaySize + "px";
  brushCursor.style.height = displaySize + "px";
}

// ---------- Box Select (SAM) ----------
//
// Lazy-loaded entirely on first "Start Box Select" click -- nothing here is
// fetched during page load or Remove Background. Uses SlimSAM (a small
// interactive segmentation model, vendored under vendor/sam/) via
// transformers.js (vendored under vendor/transformers/), independent of the
// isnet background-removal pipeline above. The expensive image-embedding
// pass runs once per source photo (cached, keyed by samImageVersion); box
// drags and point clicks only re-run the fast decoder.

function ensureSamLoaded() {
  if (samModel && samProcessor) return Promise.resolve();
  if (!samLoadingPromise) {
    samLoadingPromise = loadSam().catch((err) => {
      samLoadingPromise = null; // allow retrying after a failed load
      throw err;
    });
  }
  return samLoadingPromise;
}

async function loadSam() {
  samProgressWrap.hidden = false;
  samProgressBar.style.width = "0%";
  setStatus("Loading Box Select model… (one-time ~24MB download, cached after this)");

  const mod = await import("./vendor/transformers/transformers.js");
  const { SamModel, AutoProcessor, env } = mod;

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = new URL("./vendor/", import.meta.url).toString();
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("./vendor/onnxruntime-web-sam/ort-wasm-simd-threaded.mjs", import.meta.url).href,
    wasm: new URL("./vendor/onnxruntime-web-sam/ort-wasm-simd-threaded.wasm", import.meta.url).href,
  };

  const progressState = new Map();
  const onProgress = (data) => {
    if (data.status !== "progress" || !data.total) return;
    progressState.set(data.file, { loaded: data.loaded, total: data.total });
    let loaded = 0, total = 0;
    for (const v of progressState.values()) {
      loaded += v.loaded;
      total += v.total;
    }
    if (total) samProgressBar.style.width = Math.round((loaded / total) * 100) + "%";
  };

  const [model, processor] = await Promise.all([
    SamModel.from_pretrained("sam", { dtype: "q8", device: "wasm", progress_callback: onProgress }),
    AutoProcessor.from_pretrained("sam", { progress_callback: onProgress }),
  ]);

  samModule = mod;
  samModel = model;
  samProcessor = processor;
  samProgressWrap.hidden = true;
}

async function ensureSamEmbeddings() {
  if (samEmbeddingsVersion === samImageVersion && samImageEmbeddings) return;
  setStatus("Analyzing image for Box Select…");
  const { RawImage } = samModule;
  const image = await RawImage.read(originalCanvas);
  samImageProcessed = await samProcessor(image);
  samImageEmbeddings = await samModel.get_image_embeddings(samImageProcessed);
  samEmbeddingsVersion = samImageVersion;
}

function activateBoxSelect() {
  activeTool = "boxSelect";
  samBox = null;
  samPoints = [];
  samMask = null;
  boxSelectToolBtn.textContent = "Cancel Box Select";
  boxSelectActions.hidden = true;
  brushCursor.hidden = true;
  workingCanvas.style.cursor = "crosshair";
  samOverlay.hidden = false;
  positionSamOverlay();
  clearSamOverlay();
  setStatus("Drag a box around the object you want to select.");
}

function deactivateBoxSelect() {
  activeTool = "touchup";
  samBox = null;
  samPoints = [];
  samMask = null;
  samDragging = false;
  samDragStart = null;
  boxSelectToolBtn.textContent = "Start Box Select";
  boxSelectActions.hidden = true;
  samOverlay.hidden = true;
  workingCanvas.style.cursor = "";
  clearSamOverlay();
  if (hasResult) {
    setStatus('Pick Erase or Restore, then Brush (precise) or Magic Wand (click a whole same-color area) below.');
  }
}

boxSelectToolBtn.addEventListener("click", async () => {
  if (activeTool === "boxSelect") {
    deactivateBoxSelect();
    return;
  }
  if (!hasResult) return;
  boxSelectToolBtn.disabled = true;
  try {
    await ensureSamLoaded();
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load Box Select: " + err.message);
    samProgressWrap.hidden = true;
    boxSelectToolBtn.disabled = false;
    return;
  }
  boxSelectToolBtn.disabled = false;
  activateBoxSelect();
});

function normalizeBox(a, b) {
  const w = workingCanvas.width, h = workingCanvas.height;
  return {
    x0: Math.max(0, Math.min(a.x, b.x)),
    y0: Math.max(0, Math.min(a.y, b.y)),
    x1: Math.min(w, Math.max(a.x, b.x)),
    y1: Math.min(h, Math.max(a.y, b.y)),
  };
}

function centerPointOf(box) {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, label: 1 };
}

function positionSamOverlay() {
  const wrapRect = canvasWrap.getBoundingClientRect();
  const canvasRect = workingCanvas.getBoundingClientRect();
  samOverlay.width = workingCanvas.width;
  samOverlay.height = workingCanvas.height;
  samOverlay.style.left = canvasRect.left - wrapRect.left + canvasWrap.scrollLeft + "px";
  samOverlay.style.top = canvasRect.top - wrapRect.top + canvasWrap.scrollTop + "px";
  samOverlay.style.width = canvasRect.width + "px";
  samOverlay.style.height = canvasRect.height + "px";
}

function clearSamOverlay() {
  samCtx.clearRect(0, 0, samOverlay.width, samOverlay.height);
}

function drawSamOverlay() {
  clearSamOverlay();
  const w = samOverlay.width, h = samOverlay.height;

  if (samMask) {
    const imgData = samCtx.createImageData(w, h);
    const px = imgData.data;
    for (let i = 0; i < w * h; i++) {
      if (samMask[i]) {
        const p = i * 4;
        px[p] = 34;
        px[p + 1] = 211;
        px[p + 2] = 238;
        px[p + 3] = 115;
      }
    }
    samCtx.putImageData(imgData, 0, 0);
  }

  const rect = workingCanvas.getBoundingClientRect();
  const bitmapToScreen = w / (rect.width || w);

  if (samBox) {
    samCtx.save();
    samCtx.strokeStyle = "#22d3ee";
    samCtx.lineWidth = Math.max(1, 2 * bitmapToScreen);
    samCtx.setLineDash([6 * bitmapToScreen, 4 * bitmapToScreen]);
    samCtx.strokeRect(samBox.x0, samBox.y0, samBox.x1 - samBox.x0, samBox.y1 - samBox.y0);
    samCtx.restore();
  }

  const markerR = Math.max(4, 6 * bitmapToScreen);
  for (const pt of samPoints) {
    samCtx.beginPath();
    samCtx.arc(pt.x, pt.y, markerR, 0, Math.PI * 2);
    samCtx.fillStyle = pt.label === 1 ? "#22d3ee" : "#ff6b6b";
    samCtx.fill();
    samCtx.strokeStyle = "#0c0f14";
    samCtx.lineWidth = Math.max(1, 1.5 * bitmapToScreen);
    samCtx.stroke();
  }
}

async function runSamPrompt() {
  if (samBusy) {
    samPromptQueued = true;
    return;
  }
  samBusy = true;
  try {
    await ensureSamEmbeddings();
    const { Tensor } = samModule;
    const points = samPoints.length ? samPoints : samBox ? [centerPointOf(samBox)] : [];
    if (!points.length) return;

    const inputPointsTensor = samProcessor.reshape_input_points(
      [points.map((p) => [p.x, p.y])],
      samImageProcessed.original_sizes,
      samImageProcessed.reshaped_input_sizes
    );
    const inputLabelsTensor = new Tensor(
      "int64",
      points.map((p) => BigInt(p.label)),
      [1, 1, points.length]
    );

    const decodeInputs = {
      ...samImageEmbeddings,
      input_points: inputPointsTensor,
      input_labels: inputLabelsTensor,
    };
    if (samBox) {
      decodeInputs.input_boxes = samProcessor.reshape_input_points(
        [[[samBox.x0, samBox.y0, samBox.x1, samBox.y1]]],
        samImageProcessed.original_sizes,
        samImageProcessed.reshaped_input_sizes,
        true
      );
    }

    const { pred_masks, iou_scores } = await samModel(decodeInputs);
    const masks = await samProcessor.post_process_masks(
      pred_masks,
      samImageProcessed.original_sizes,
      samImageProcessed.reshaped_input_sizes
    );

    const { RawImage } = samModule;
    const maskImage = RawImage.fromTensor(masks[0][0]);
    const scores = iou_scores.data;
    let bestIndex = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[bestIndex]) bestIndex = i;
    }
    const numMasks = scores.length;
    const mw = maskImage.width, mh = maskImage.height;
    const maskArr = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) {
      maskArr[i] = maskImage.data[numMasks * i + bestIndex] === 1 ? 1 : 0;
    }
    samMask = maskArr;
    boxSelectActions.hidden = false;
    drawSamOverlay();
    setStatus(`Selection ready (score ${scores[bestIndex].toFixed(2)}). Click to add, Shift+Click to remove, or Apply.`);
  } catch (err) {
    console.error(err);
    setStatus("Box Select error: " + err.message);
  } finally {
    samBusy = false;
    if (samPromptQueued) {
      samPromptQueued = false;
      runSamPrompt();
    }
  }
}

samApplyBtn.addEventListener("click", () => {
  if (!samMask) return;
  const w = workingCanvas.width, h = workingCanvas.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (samMask[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    deactivateBoxSelect();
    return;
  }

  pushUndo();
  const snap = ctxWorking.getImageData(0, 0, w, h);
  const buf = snap.data;
  const orig = originalImageData.data;
  const erase = currentTool === "erase";
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if (!samMask[i]) continue;
      const p = i * 4;
      if (erase) {
        buf[p] = 0;
        buf[p + 1] = 0;
        buf[p + 2] = 0;
        buf[p + 3] = 0;
      } else {
        buf[p] = orig[p];
        buf[p + 1] = orig[p + 1];
        buf[p + 2] = orig[p + 2];
        buf[p + 3] = orig[p + 3];
      }
    }
  }
  ctxWorking.putImageData(snap, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  deactivateBoxSelect();
});

samCancelBtn.addEventListener("click", () => {
  deactivateBoxSelect();
});

// ---------- Zoom ----------

function applyZoom() {
  if (!hasImage) return;
  const fitWidth = Math.min(canvasWrap.clientWidth, workingCanvas.width);
  const displayWidth = fitWidth * zoom;
  const displayHeight = displayWidth * (workingCanvas.height / workingCanvas.width);
  workingCanvas.style.width = displayWidth + "px";
  workingCanvas.style.height = displayHeight + "px";
  zoomIndicator.hidden = false;
  zoomIndicator.textContent = Math.round(zoom * 100) + "%";
  updateCursorSize();
  if (activeTool === "boxSelect") {
    positionSamOverlay();
    drawSamOverlay();
  }
}

function resetZoom() {
  zoom = 1;
  applyZoom();
  canvasWrap.scrollLeft = 0;
  canvasWrap.scrollTop = 0;
}

canvasWrap.addEventListener(
  "wheel",
  (e) => {
    if (!hasImage) return;
    e.preventDefault();
    const oldZoom = zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    if (zoom === oldZoom) return;

    const wrapRect = canvasWrap.getBoundingClientRect();
    const anchorX = e.clientX - wrapRect.left + canvasWrap.scrollLeft;
    const anchorY = e.clientY - wrapRect.top + canvasWrap.scrollTop;
    const scaleRatio = zoom / oldZoom;

    applyZoom();

    canvasWrap.scrollLeft = anchorX * scaleRatio - (e.clientX - wrapRect.left);
    canvasWrap.scrollTop = anchorY * scaleRatio - (e.clientY - wrapRect.top);
    updateCursorPosition(e);
  },
  { passive: false }
);

zoomIndicator.addEventListener("click", resetZoom);
window.addEventListener("resize", () => {
  updateCursorSize();
  applyZoom();
});

// ---------- Undo / redo / reset ----------

undoBtn.addEventListener("click", () => {
  if (undoStack.length === 0) return;
  const current = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  redoStack.push(current);
  const prev = undoStack.pop();
  ctxWorking.putImageData(prev, 0, 0);
  updateUndoRedoButtons();
});

redoBtn.addEventListener("click", () => {
  if (redoStack.length === 0) return;
  const current = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  undoStack.push(current);
  const next = redoStack.pop();
  ctxWorking.putImageData(next, 0, 0);
  updateUndoRedoButtons();
});

resetBtn.addEventListener("click", () => {
  if (!baselineImageData) return;
  if (!confirm("Discard all touch-ups and reset to the AI result?")) return;
  pushUndo();
  ctxWorking.putImageData(baselineImageData, 0, 0);
});

// ---------- Export / new image ----------

downloadBtn.addEventListener("click", () => {
  workingCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "background-removed.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "image/png");
});

newImageBtn.addEventListener("click", () => {
  hasImage = false;
  hasResult = false;
  fileInput.value = "";
  toolPanel.hidden = true;
  exportPanel.hidden = true;
  boxSelectPanel.hidden = true;
  if (activeTool === "boxSelect") deactivateBoxSelect();
  dropzone.style.display = "flex";
  removeBgBtn.disabled = true;
  ctxWorking.clearRect(0, 0, workingCanvas.width, workingCanvas.height);
  workingCanvas.style.width = "";
  workingCanvas.style.height = "";
  zoom = 1;
  zoomIndicator.hidden = true;
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
  setStatus("Choose an image to get started.");
});

updateCursorSize();
