import { removeBackground } from "./vendor/background-removal.bundle.mjs";

const MAX_DIM = 1600;
const UNDO_LIMIT = 15;

const fileInput = document.getElementById("fileInput");
const removeBgBtn = document.getElementById("removeBgBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const toolPanel = document.getElementById("toolPanel");
const exportPanel = document.getElementById("exportPanel");
const eraseToolBtn = document.getElementById("eraseToolBtn");
const magicEraseToolBtn = document.getElementById("magicEraseToolBtn");
const restoreToolBtn = document.getElementById("restoreToolBtn");
const toolHint = document.getElementById("toolHint");
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
let brushSize = 40;
let softness = 0.5;
let tolerance = 31; // matches the tolerance slider's default (12%) of 255
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
    updateUndoRedoButtons();
    applyZoom();
    setStatus('Background removed. Use "Magic Erase" to clear out leftover background in one click, "Erase" for freehand cleanup, or "Restore" to bring parts back.');
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
  erase: "Erase paints transparent with a soft brush — good for freehand cleanup.",
  magicErase: 'Magic Erase: click a background area to remove the whole connected same-color region. Stops at outlines, so matching colors on the subject (like white-on-white) are safe.',
  restore: 'Restore: click an erased area to bring back the whole connected same-color region from the original image.',
};

function setTool(tool) {
  currentTool = tool;
  eraseToolBtn.classList.toggle("active", tool === "erase");
  magicEraseToolBtn.classList.toggle("active", tool === "magicErase");
  restoreToolBtn.classList.toggle("active", tool === "restore");
  toolHint.textContent = TOOL_HINTS[tool];
}
eraseToolBtn.addEventListener("click", () => setTool("erase"));
magicEraseToolBtn.addEventListener("click", () => setTool("magicErase"));
restoreToolBtn.addEventListener("click", () => setTool("restore"));

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

// Flood-fills outward from a brush-sized seed disc through pixels of the
// *original* image that are connected and color-similar (neighbor-to-neighbor,
// within `tolerance`). `erase` selects the action on each matched pixel:
// true clears it to transparent, false restores it from the original image.
// Returns the touched bounding box (for a cheap partial putImageData), or
// null if the seed was entirely out of bounds / already filled.
function floodFillStamp(cx, cy, erase) {
  if (!strokeImageData || !originalImageData) return null;
  const w = workingCanvas.width;
  const h = workingCanvas.height;
  const buf = strokeImageData.data;
  const orig = originalImageData.data;
  const r = brushSize;
  const tol = tolerance;

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
    const p = idx * 4;
    const or_ = orig[p], og = orig[p + 1], ob = orig[p + 2];

    // 4-connected neighbors, inlined for hot-loop performance
    if (x > 0) {
      const nidx = idx - 1;
      if (fillVisited[nidx] !== gen) {
        fillVisited[nidx] = gen;
        const np = nidx * 4;
        if (Math.max(Math.abs(orig[np] - or_), Math.abs(orig[np + 1] - og), Math.abs(orig[np + 2] - ob)) <= tol) {
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
        const np = nidx * 4;
        if (Math.max(Math.abs(orig[np] - or_), Math.abs(orig[np + 1] - og), Math.abs(orig[np + 2] - ob)) <= tol) {
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
        const np = nidx * 4;
        if (Math.max(Math.abs(orig[np] - or_), Math.abs(orig[np + 1] - og), Math.abs(orig[np + 2] - ob)) <= tol) {
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
        const np = nidx * 4;
        if (Math.max(Math.abs(orig[np] - or_), Math.abs(orig[np + 1] - og), Math.abs(orig[np + 2] - ob)) <= tol) {
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
  if (currentTool === "erase") {
    ctxWorking.globalCompositeOperation = "destination-out";
    ctxWorking.drawImage(brushCanvas, x - r, y - r);
    ctxWorking.globalCompositeOperation = "source-over";
  } else {
    const dirty = floodFillStamp(Math.round(x), Math.round(y), currentTool === "magicErase");
    if (dirty) {
      ctxWorking.putImageData(strokeImageData, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
    }
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
  if (!hasResult) return;
  try {
    workingCanvas.setPointerCapture(e.pointerId);
  } catch {
    // some input sources (synthetic events, certain stylus drivers) don't support capture; drawing still works without it
  }
  pushUndo();
  isDrawing = true;
  lastPoint = null;
  if (currentTool === "magicErase" || currentTool === "restore") {
    strokeImageData = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  }
  const p = getCanvasPoint(e);
  strokeTo(p);
});

let lastPointerEvent = null;

workingCanvas.addEventListener("pointermove", (e) => {
  lastPointerEvent = e;
  updateCursorPosition(e);
  if (!isDrawing) return;
  const p = getCanvasPoint(e);
  strokeTo(p);
});

canvasWrap.addEventListener("scroll", () => {
  if (lastPointerEvent) updateCursorPosition(lastPointerEvent);
});

window.addEventListener("pointerup", () => {
  isDrawing = false;
  lastPoint = null;
  strokeImageData = null;
});

canvasWrap.addEventListener("pointerenter", () => {
  if (hasResult) brushCursor.hidden = false;
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
