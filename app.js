const MAX_DIM = 1600;
const UNDO_LIMIT = 15;
// The scene is a generously-sized, fixed working area -- not just "the size
// of whatever photo you loaded" -- so there's real room to drag layers
// around without them clipping out of view at the edges.
const SCENE_SIZE = 1600;

const fileInput = document.getElementById("fileInput");
const toolPanel = document.getElementById("toolPanel");
const exportPanel = document.getElementById("exportPanel");
const boxSelectToolBtn = document.getElementById("boxSelectToolBtn");
const samProgressWrap = document.getElementById("samProgressWrap");
const samProgressBar = document.getElementById("samProgressBar");
const boxSelectActions = document.getElementById("boxSelectActions");
const samApplyBtn = document.getElementById("samApplyBtn");
const samCancelBtn = document.getElementById("samCancelBtn");
const samIsolateCheckbox = document.getElementById("samIsolateCheckbox");
const boxSelectHint = document.getElementById("boxSelectHint");
const samOverlay = document.getElementById("samOverlay");
const samCtx = samOverlay.getContext("2d");
const layersPanel = document.getElementById("layersPanel");
const layerList = document.getElementById("layerList");
const addLayerInput = document.getElementById("addLayerInput");
const layerTransformBtn = document.getElementById("layerTransformBtn");
const layerOverlay = document.getElementById("layerOverlay");
const layerCtx = layerOverlay.getContext("2d");
const addTextBtn = document.getElementById("addTextBtn");
const addTextForm = document.getElementById("addTextForm");
const textContentInput = document.getElementById("textContentInput");
const textFontSize = document.getElementById("textFontSize");
const textFontSizeVal = document.getElementById("textFontSizeVal");
const textColorInput = document.getElementById("textColorInput");
const textFontFamily = document.getElementById("textFontFamily");
const addTextConfirmBtn = document.getElementById("addTextConfirmBtn");
const addTextCancelBtn = document.getElementById("addTextCancelBtn");
const eraseToolBtn = document.getElementById("eraseToolBtn");
const restoreToolBtn = document.getElementById("restoreToolBtn");
const brushModeBtn = document.getElementById("brushModeBtn");
const magicModeBtn = document.getElementById("magicModeBtn");
const brushControls = document.getElementById("brushControls");
const boxSelectControls = document.getElementById("boxSelectControls");
const moveLayerControls = document.getElementById("moveLayerControls");
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
const brushCursor = document.getElementById("brushCursor");
const statusEl = document.getElementById("status");
const themeColorInput = document.getElementById("themeColorInput");

// ---------- Scene (the one real, visible <canvas>) ----------
//
// The scene is the composited view of every layer stacked together. Its
// bitmap size is fixed to the first layer's native size when the first
// image loads, and stays fixed afterward -- later layers are positioned
// and scaled *within* that fixed scene, they don't resize it.
const sceneCanvas = document.getElementById("workingCanvas");
const ctxScene = sceneCanvas.getContext("2d", { willReadFrequently: true });

// ---------- Layers ----------
//
// Each layer owns its own pixel data (an offscreen canvas + its pristine
// "original" source + flood-fill/undo/SAM state). `workingCanvas`/
// `ctxWorking`/`originalCanvas`/etc. below are NOT the scene -- they're a
// reassignable "view" onto whichever layer is currently active, so every
// existing tool (brush, flood fill, Box Select, undo/redo) keeps reading/
// writing those exact names without any logic changes;
// they just now mean "the active layer's pixels" instead of "the one photo."
let layers = [];
let activeLayerIndex = -1;
let layerIdCounter = 0;

function activeLayer() {
  return layers[activeLayerIndex];
}

// Shared layer constructor -- takes any already-drawn source canvas, so both
// photo layers and text layers (see createTextLayer below) build the exact
// same Layer shape and get every existing capability (move/resize/reorder/
// delete/undo/touch-up/Box Select) for free.
function createLayerFromCanvas(sourceCanvas, name, opts = {}) {
  const width = sourceCanvas.width, height = sourceCanvas.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);

  const oCanvas = document.createElement("canvas");
  oCanvas.width = width;
  oCanvas.height = height;
  const oCtx = oCanvas.getContext("2d", { willReadFrequently: true });
  oCtx.drawImage(sourceCanvas, 0, 0);
  const oImageData = oCtx.getImageData(0, 0, width, height);

  return {
    id: ++layerIdCounter,
    name,
    canvas,
    ctx,
    originalCanvas: oCanvas,
    ctxOriginal: oCtx,
    originalImageData: oImageData,
    fillVisited: new Int32Array(width * height).fill(-1),
    fillGen: 0,
    baselineImageData: opts.hasResult ? ctx.getImageData(0, 0, width, height) : null,
    hasResult: !!opts.hasResult,
    undoStack: [],
    redoStack: [],
    samImageProcessed: null,
    samImageEmbeddings: null,
    x: 0,
    y: 0,
    scale: 1,
  };
}

function createLayerFromBitmap(bitmap, width, height, name) {
  const tmp = document.createElement("canvas");
  tmp.width = width;
  tmp.height = height;
  tmp.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  return createLayerFromCanvas(tmp, name);
}

// Unlike a photo, text has no separate "AI extraction" step before it's
// touch-up-ready -- it's rendered final at creation, so hasResult/
// baselineImageData are set immediately.
function createTextLayer(text, { fontSize, color, fontFamily }) {
  const measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${fontSize}px ${fontFamily}`;
  const metrics = measureCtx.measureText(text);
  const padding = Math.ceil(fontSize * 0.3);
  const width = Math.max(1, Math.ceil(metrics.width) + padding * 2);
  const height = Math.max(1, Math.ceil(fontSize * 1.3));

  const tmp = document.createElement("canvas");
  tmp.width = width;
  tmp.height = height;
  const tctx = tmp.getContext("2d");
  tctx.font = `${fontSize}px ${fontFamily}`;
  tctx.fillStyle = color;
  tctx.textBaseline = "middle";
  tctx.fillText(text, padding, height / 2);

  return createLayerFromCanvas(tmp, text.slice(0, 24) || "Text", { hasResult: true });
}

// Reassignable "active layer view" -- see comment above.
let workingCanvas = null;
let ctxWorking = null;
let originalCanvas = null;
let ctxOriginal = null;
let originalImageData = null;
let fillVisited = null;
let fillGen = 0;
let baselineImageData = null;
let hasResult = false;
let undoStack = [];
let redoStack = [];
let samImageProcessed = null;
let samImageEmbeddings = null;

function syncActiveLayerGlobals() {
  const L = activeLayer();
  workingCanvas = L.canvas;
  ctxWorking = L.ctx;
  originalCanvas = L.originalCanvas;
  ctxOriginal = L.ctxOriginal;
  originalImageData = L.originalImageData;
  fillVisited = L.fillVisited;
  fillGen = L.fillGen;
  baselineImageData = L.baselineImageData;
  hasResult = L.hasResult;
  undoStack = L.undoStack;
  redoStack = L.redoStack;
  samImageProcessed = L.samImageProcessed;
  samImageEmbeddings = L.samImageEmbeddings;
}

// Primitive/reassignable fields (fillGen, baselineImageData, hasResult, the
// SAM embedding cache) don't automatically stay in sync with the layer
// object the way shared canvas/array references do -- this flushes the
// current "view" back before switching away from a layer.
function saveActiveLayerGlobals() {
  if (activeLayerIndex < 0) return;
  const L = activeLayer();
  L.fillGen = fillGen;
  L.baselineImageData = baselineImageData;
  L.hasResult = hasResult;
  L.samImageProcessed = samImageProcessed;
  L.samImageEmbeddings = samImageEmbeddings;
}

function renderComposite() {
  ctxScene.clearRect(0, 0, sceneCanvas.width, sceneCanvas.height);
  for (const L of layers) {
    ctxScene.drawImage(
      L.canvas,
      0, 0, L.canvas.width, L.canvas.height,
      L.x, L.y, L.canvas.width * L.scale, L.canvas.height * L.scale
    );
  }
}

function refreshPanels() {
  const any = layers.length > 0;
  layersPanel.hidden = !any;
  exportPanel.hidden = !any;
  toolPanel.hidden = !any;
  updateBoxSelectHint();
  updateUndoRedoButtons();
}

let currentTool = "erase";
let magicMode = false;
let brushSize = 40;
let softness = 0.5;
let tolerance = 20; // matches the tolerance slider's default (8%) of 255
let isDrawing = false;
let lastPoint = null;
let hasImage = false;

let strokeImageData = null;

let activeTool = "touchup"; // "touchup" | "boxSelect"
let samModule = null; // { SamModel, AutoProcessor, RawImage, Tensor, env }
let samModel = null;
let samProcessor = null;
let samLoadingPromise = null;
let samBox = null; // {x0,y0,x1,y1} in active-layer-local pixel space
let samPoints = []; // [{x, y, label}]
let samMask = null; // Uint8Array, one byte per pixel, active-layer-local resolution
let samDragStart = null;
let samDragging = false;
let samMoved = false;
let samBusy = false;
let samPromptQueued = false;
let samMoveDX = 0;
let samMoveDY = 0;
let samMoveActive = false;
let samMoveStart = null;
let samMoveOrigDX = 0;
let samMoveOrigDY = 0;

let layerDragMode = null; // null | "move" | "resize"
let layerDragStart = null;
let layerDragOrigX = 0;
let layerDragOrigY = 0;
let layerDragOrigScale = 1;

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

  layers = [createLayerFromBitmap(bitmap, width, height, "Layer 1")];
  activeLayerIndex = 0;
  sceneCanvas.width = SCENE_SIZE;
  sceneCanvas.height = SCENE_SIZE;
  layers[0].x = (SCENE_SIZE - width) / 2;
  layers[0].y = (SCENE_SIZE - height) / 2;
  syncActiveLayerGlobals();

  hasImage = true;
  if (activeTool === "boxSelect") deactivateBoxSelect();
  dropzone.style.display = "none";
  refreshPanels();
  renderLayerList();
  renderComposite();
  resetZoom();
  setStatus(`Loaded image (${width}×${height}). Pick a tool below to start.`);
}

// Adds a photo as a new layer on top of whatever's already there, instead of
// replacing it -- the scene's own size (set by the first layer) never
// changes; later layers are just positioned/scaled within it.
// Positions a freshly-created layer centered and fit within 80% of the
// scene, then makes it the active layer and refreshes every dependent UI
// bit -- shared by both "add a photo" and "add text".
function pushNewLayer(layer) {
  const fitScale = Math.min(1, (sceneCanvas.width * 0.8) / layer.canvas.width, (sceneCanvas.height * 0.8) / layer.canvas.height);
  layer.scale = fitScale;
  layer.x = (sceneCanvas.width - layer.canvas.width * fitScale) / 2;
  layer.y = (sceneCanvas.height - layer.canvas.height * fitScale) / 2;

  saveActiveLayerGlobals();
  layers.push(layer);
  activeLayerIndex = layers.length - 1;
  syncActiveLayerGlobals();

  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  refreshPanels();
  renderLayerList();
  renderComposite();
  setStatus(`Added "${layer.name}" as a new layer.`);
}

async function addLayer(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const layer = createLayerFromBitmap(bitmap, width, height, `Layer ${layers.length + 1}`);
  pushNewLayer(layer);
}

function loadOrAddImage(file) {
  if (layers.length === 0) {
    loadImageFile(file);
  } else {
    addLayer(file);
  }
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadOrAddImage(file);
});

addLayerInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadOrAddImage(file);
});

textFontSize.addEventListener("input", () => {
  textFontSizeVal.textContent = textFontSize.value;
});

addTextBtn.addEventListener("click", () => {
  addTextForm.hidden = false;
  addTextBtn.hidden = true;
  textContentInput.value = "";
  textContentInput.focus();
});

addTextCancelBtn.addEventListener("click", () => {
  addTextForm.hidden = true;
  addTextBtn.hidden = false;
});

addTextConfirmBtn.addEventListener("click", () => {
  const text = textContentInput.value.trim();
  if (!text) {
    textContentInput.focus();
    return;
  }
  const layer = createTextLayer(text, {
    fontSize: Number(textFontSize.value),
    color: textColorInput.value,
    fontFamily: textFontFamily.value,
  });
  pushNewLayer(layer);
  addTextForm.hidden = true;
  addTextBtn.hidden = false;
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
  if (file && file.type.startsWith("image/")) loadOrAddImage(file);
});

// ---------- Layer list / selection / reorder / delete ----------

function setActiveLayer(index) {
  if (index === activeLayerIndex) return;
  saveActiveLayerGlobals();
  activeLayerIndex = index;
  syncActiveLayerGlobals();
  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  refreshPanels();
  renderLayerList();
  updateCursorSize();
  setStatus(
    hasResult
      ? 'Pick Erase or Restore, then Brush (precise) or Magic Wand (click a whole same-color area) below.'
      : `"${activeLayer().name}" selected. Pick a tool below to start.`
  );
}

function moveLayerTo(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= layers.length) return;
  const activeId = activeLayer().id;
  const [moved] = layers.splice(fromIndex, 1);
  layers.splice(toIndex, 0, moved);
  activeLayerIndex = layers.findIndex((L) => L.id === activeId);
  renderLayerList();
  renderComposite();
}

function deleteLayer(index) {
  if (!confirm(`Delete "${layers[index].name}"?`)) return;
  const wasActive = index === activeLayerIndex;
  layers.splice(index, 1);
  if (layers.length === 0) {
    resetAllLayers();
    return;
  }
  if (wasActive) {
    activeLayerIndex = Math.min(index, layers.length - 1);
    syncActiveLayerGlobals();
  } else if (index < activeLayerIndex) {
    activeLayerIndex--;
  }
  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  refreshPanels();
  renderLayerList();
  renderComposite();
}

function renderLayerList() {
  layerList.innerHTML = "";
  // Front-most layer (drawn last, on top) shown first in the list.
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    const row = document.createElement("div");
    row.className = "layer-row" + (i === activeLayerIndex ? " active" : "");

    const handle = document.createElement("span");
    handle.className = "layer-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.setData("text/plain", String(i));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      row.classList.remove("dragging");
    });
    row.appendChild(handle);

    const thumb = document.createElement("canvas");
    thumb.width = 36;
    thumb.height = 36;
    const tctx = thumb.getContext("2d");
    const s = Math.min(36 / L.canvas.width, 36 / L.canvas.height);
    const tw = L.canvas.width * s, th = L.canvas.height * s;
    tctx.drawImage(L.canvas, (36 - tw) / 2, (36 - th) / 2, tw, th);
    row.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = L.name;
    row.appendChild(name);

    const btns = document.createElement("div");
    btns.className = "layer-btns";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "🗑";
    delBtn.title = "Delete layer";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLayer(i);
    });
    btns.appendChild(delBtn);

    row.appendChild(btns);
    row.addEventListener("click", () => setActiveLayer(i));

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      const fromIndex = Number(e.dataTransfer.getData("text/plain"));
      moveLayerTo(fromIndex, i);
    });

    layerList.appendChild(row);
  }
}

function resetAllLayers() {
  layers = [];
  activeLayerIndex = -1;
  workingCanvas = null;
  ctxWorking = null;
  originalCanvas = null;
  ctxOriginal = null;
  originalImageData = null;
  fillVisited = null;
  fillGen = 0;
  baselineImageData = null;
  hasResult = false;
  undoStack = [];
  redoStack = [];
  samImageProcessed = null;
  samImageEmbeddings = null;

  hasImage = false;
  fileInput.value = "";
  addLayerInput.value = "";
  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  dropzone.style.display = "flex";
  ctxScene.clearRect(0, 0, sceneCanvas.width, sceneCanvas.height);
  sceneCanvas.style.width = "";
  sceneCanvas.style.height = "";
  zoom = 1;
  zoomIndicator.hidden = true;
  refreshPanels();
  renderLayerList();
  setStatus("Choose an image to get started.");
}

// ---------- Tools ----------

const TOOL_HINTS = {
  "erase-brush": "Erase paints transparent wherever you drag — precise, freehand cleanup.",
  "erase-magic": "Magic Erase: click a background area to remove the whole connected same-color region. Stops at outlines, so matching colors on the subject (like white-on-white) are safe — but connected same-color areas with no outline between them (e.g. a skirt and shirt of the same white) will go together. Switch to Brush for precise control.",
  "restore-brush": "Restore paints back the original image wherever you drag — precise, freehand.",
  "restore-magic": "Magic Restore: click an erased area to bring back the whole connected same-color region from the original image.",
};

// Single source of truth for "which of the 4 tools is active" -- merges
// what used to be two separate, confusingly-related states (magicMode, and
// activeTool's boxSelect/layerTransform values) into one selector so there's
// exactly one row of buttons to look at, instead of tools scattered across
// panels with Box Select silently reading Erase/Restore from elsewhere.
function primaryTool() {
  if (activeTool === "boxSelect") return "box";
  if (activeTool === "layerTransform") return "move";
  return magicMode ? "wand" : "brush";
}

function updatePrimaryToolUI() {
  const primary = primaryTool();

  eraseToolBtn.classList.toggle("active", currentTool === "erase");
  restoreToolBtn.classList.toggle("active", currentTool === "restore");
  brushModeBtn.classList.toggle("active", primary === "brush");
  magicModeBtn.classList.toggle("active", primary === "wand");
  boxSelectToolBtn.classList.toggle("active", primary === "box");
  layerTransformBtn.classList.toggle("active", primary === "move");

  const isBrushOrWand = primary === "brush" || primary === "wand";
  brushControls.hidden = !isBrushOrWand;
  boxSelectControls.hidden = primary !== "box";
  moveLayerControls.hidden = primary !== "move";
  toolHint.hidden = !isBrushOrWand;

  softnessRow.hidden = primary !== "brush";
  softnessInput.hidden = primary !== "brush";
  toleranceRow.hidden = primary !== "wand";
  toleranceInput.hidden = primary !== "wand";

  if (isBrushOrWand) {
    toolHint.textContent = TOOL_HINTS[`${currentTool}-${primary === "wand" ? "magic" : "brush"}`];
  }
}

function setTool(tool) {
  currentTool = tool;
  updatePrimaryToolUI();
}
function setMode(magic) {
  magicMode = magic;
  updatePrimaryToolUI();
}
eraseToolBtn.addEventListener("click", () => setTool("erase"));
restoreToolBtn.addEventListener("click", () => setTool("restore"));
brushModeBtn.addEventListener("click", () => {
  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  setMode(false);
});
magicModeBtn.addEventListener("click", () => {
  if (activeTool === "boxSelect") deactivateBoxSelect();
  if (activeTool === "layerTransform") deactivateLayerTransform();
  setMode(true);
});
boxSelectToolBtn.addEventListener("click", async () => {
  if (activeTool === "boxSelect") {
    deactivateBoxSelect();
    return;
  }
  if (activeTool === "layerTransform") deactivateLayerTransform();
  if (!hasImage) return;
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
layerTransformBtn.addEventListener("click", () => {
  if (activeTool === "layerTransform") {
    deactivateLayerTransform();
    return;
  }
  if (activeTool === "boxSelect") deactivateBoxSelect();
  activateLayerTransform();
});
updatePrimaryToolUI();

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

// Maps a screen pointer event to the *active layer's own local pixel
// space* -- the scene may show the layer positioned/scaled anywhere within
// it, so a screen point first maps to scene-bitmap space, then un-translates
// and un-scales by the active layer's own x/y/scale.
function getCanvasPoint(evt) {
  const rect = sceneCanvas.getBoundingClientRect();
  const scaleX = sceneCanvas.width / rect.width;
  const scaleY = sceneCanvas.height / rect.height;
  const sceneX = (evt.clientX - rect.left) * scaleX;
  const sceneY = (evt.clientY - rect.top) * scaleY;
  const L = activeLayer();
  return {
    x: (sceneX - L.x) / L.scale,
    y: (sceneY - L.y) / L.scale,
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
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

sceneCanvas.addEventListener("pointerdown", (e) => {
  if (activeTool === "layerTransform") {
    if (activeLayerIndex < 0) return;
    try {
      sceneCanvas.setPointerCapture(e.pointerId);
    } catch {
      // some input sources (synthetic events, certain stylus drivers) don't support capture
    }
    const p = getScenePoint(e);
    const L = activeLayer();
    if (pointInHandle(L, p)) {
      layerDragMode = "resize";
    } else if (pointInLayerBox(L, p)) {
      layerDragMode = "move";
    } else {
      layerDragMode = null;
      return;
    }
    layerDragStart = p;
    layerDragOrigX = L.x;
    layerDragOrigY = L.y;
    layerDragOrigScale = L.scale;
    return;
  }
  if (activeTool === "boxSelect") {
    if (!hasImage) return;
    try {
      sceneCanvas.setPointerCapture(e.pointerId);
    } catch {
      // some input sources (synthetic events, certain stylus drivers) don't support capture; drawing still works without it
    }
    const p = getCanvasPoint(e);
    if (samMask && pointInMask(p.x, p.y)) {
      samMoveActive = true;
      samMoveStart = p;
      samMoveOrigDX = samMoveDX;
      samMoveOrigDY = samMoveDY;
      return;
    }
    samDragStart = p;
    samDragging = true;
    samMoved = false;
    return;
  }
  if (!hasImage) return;
  try {
    sceneCanvas.setPointerCapture(e.pointerId);
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
  renderComposite();
});

let lastPointerEvent = null;

sceneCanvas.addEventListener("pointermove", (e) => {
  lastPointerEvent = e;
  if (activeTool === "layerTransform") {
    if (!layerDragMode) return;
    const p = getScenePoint(e);
    const L = activeLayer();
    if (layerDragMode === "move") {
      L.x = layerDragOrigX + (p.x - layerDragStart.x);
      L.y = layerDragOrigY + (p.y - layerDragStart.y);
    } else if (layerDragMode === "resize") {
      const origW = L.canvas.width * layerDragOrigScale;
      const newW = Math.max(10, origW + (p.x - layerDragStart.x));
      L.scale = Math.max(0.02, newW / L.canvas.width);
    }
    renderComposite();
    drawLayerOverlay();
    return;
  }
  if (activeTool === "boxSelect") {
    const p = getCanvasPoint(e);
    if (samMoveActive) {
      samMoveDX = samMoveOrigDX + (p.x - samMoveStart.x);
      samMoveDY = samMoveOrigDY + (p.y - samMoveStart.y);
      drawSamOverlay();
      return;
    }
    if (samDragging) {
      if (Math.abs(p.x - samDragStart.x) > 3 || Math.abs(p.y - samDragStart.y) > 3) samMoved = true;
      samBox = normalizeBox(samDragStart, p);
      drawSamOverlay();
      return;
    }
    sceneCanvas.style.cursor = samMask && pointInMask(p.x, p.y) ? "move" : "crosshair";
    return;
  }
  updateCursorPosition(e);
  if (!isDrawing) return;
  const p = getCanvasPoint(e);
  strokeTo(p);
  renderComposite();
});

canvasWrap.addEventListener("scroll", () => {
  if (lastPointerEvent) updateCursorPosition(lastPointerEvent);
  if (activeTool === "boxSelect") {
    positionSamOverlay();
    drawSamOverlay();
  }
  if (activeTool === "layerTransform") {
    positionLayerOverlay();
    drawLayerOverlay();
  }
});

window.addEventListener("pointerup", (e) => {
  if (activeTool === "layerTransform") {
    layerDragMode = null;
    return;
  }
  if (activeTool === "boxSelect") {
    if (samMoveActive) {
      samMoveActive = false;
      const p = getCanvasPoint(e);
      const dist = Math.hypot(p.x - samMoveStart.x, p.y - samMoveStart.y);
      if (dist <= 3) {
        // barely moved -- treat as a click on the mask (add a refinement point), not a drag
        samMoveDX = samMoveOrigDX;
        samMoveDY = samMoveOrigDY;
        samPoints.push({ x: p.x, y: p.y, label: e.shiftKey ? 0 : 1 });
        runSamPrompt();
        return;
      }
      setStatus("Selection moved. Drag it again to reposition, or Apply to place it here.");
      return;
    }
    if (samDragging) {
      samDragging = false;
      if (samMoved && samBox) {
        samPoints = [];
        samMoveDX = 0;
        samMoveDY = 0;
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
  if (hasImage && activeTool === "touchup") brushCursor.hidden = false;
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
  const rect = sceneCanvas.getBoundingClientRect();
  const sceneDisplayScale = (rect.width / sceneCanvas.width) || 1;
  const L = activeLayerIndex >= 0 ? activeLayer() : null;
  const layerScale = L ? L.scale : 1;
  const displaySize = brushSize * 2 * layerScale * sceneDisplayScale;
  brushCursor.style.width = displaySize + "px";
  brushCursor.style.height = displaySize + "px";
}

// ---------- Box Select (SAM) ----------
//
// Lazy-loaded entirely on first pick of the Box Select tool -- nothing here
// is fetched during page load. Uses SlimSAM (a small interactive
// segmentation model, vendored under vendor/sam/) via transformers.js
// (vendored under vendor/transformers/). The expensive image-embedding pass
// runs once per layer (cached on the layer itself); box drags and point
// clicks only re-run the fast decoder.

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
  if (samImageEmbeddings) return;
  setStatus("Analyzing image for Box Select…");
  const { RawImage } = samModule;
  const image = await RawImage.read(originalCanvas);
  samImageProcessed = await samProcessor(image);
  samImageEmbeddings = await samModel.get_image_embeddings(samImageProcessed);
  saveActiveLayerGlobals();
}

function updateBoxSelectHint() {
  samIsolateCheckbox.disabled = !hasResult;
  if (!hasResult) samIsolateCheckbox.checked = true;
  boxSelectHint.textContent = hasResult
    ? 'Drag a box around an object for an AI-precise selection. Click to add a point, Shift+Click to remove one, then Apply.'
    : 'Drag a box around your subject to cut it out. Refine with points, then Apply.';
}

function activateBoxSelect() {
  activeTool = "boxSelect";
  samBox = null;
  samPoints = [];
  samMask = null;
  samMoveDX = 0;
  samMoveDY = 0;
  samMoveActive = false;
  updatePrimaryToolUI();
  boxSelectActions.hidden = true;
  brushCursor.hidden = true;
  sceneCanvas.style.cursor = "crosshair";
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
  samMoveDX = 0;
  samMoveDY = 0;
  samMoveActive = false;
  samDragging = false;
  samDragStart = null;
  updatePrimaryToolUI();
  boxSelectActions.hidden = true;
  samOverlay.hidden = true;
  sceneCanvas.style.cursor = "";
  clearSamOverlay();
  if (hasResult) {
    setStatus('Pick Erase or Restore, then Brush (precise) or Magic Wand (click a whole same-color area) below.');
  }
}

function pointInMask(x, y) {
  if (!samMask) return false;
  const w = workingCanvas.width, h = workingCanvas.height;
  const px = Math.round(x - samMoveDX);
  const py = Math.round(y - samMoveDY);
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  return samMask[py * w + px] === 1;
}

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

// Positions/sizes the overlay to exactly cover the *active layer's* box as
// currently projected onto the scene (accounting for the layer's own x/y/
// scale), so masks and box/point markers -- all in layer-local pixel space
// -- line up correctly regardless of where/how large the layer sits.
function positionSamOverlay() {
  const wrapRect = canvasWrap.getBoundingClientRect();
  const sceneRect = sceneCanvas.getBoundingClientRect();
  const sceneDisplayScale = (sceneRect.width / sceneCanvas.width) || 1;
  const L = activeLayer();
  samOverlay.width = L.canvas.width;
  samOverlay.height = L.canvas.height;
  const onScreenX = sceneRect.left + L.x * sceneDisplayScale;
  const onScreenY = sceneRect.top + L.y * sceneDisplayScale;
  const onScreenW = L.canvas.width * L.scale * sceneDisplayScale;
  const onScreenH = L.canvas.height * L.scale * sceneDisplayScale;
  samOverlay.style.left = onScreenX - wrapRect.left + canvasWrap.scrollLeft + "px";
  samOverlay.style.top = onScreenY - wrapRect.top + canvasWrap.scrollTop + "px";
  samOverlay.style.width = onScreenW + "px";
  samOverlay.style.height = onScreenH + "px";
}

function clearSamOverlay() {
  samCtx.clearRect(0, 0, samOverlay.width, samOverlay.height);
}

function drawSamOverlay() {
  clearSamOverlay();
  const w = samOverlay.width, h = samOverlay.height;
  const moved = samMoveDX !== 0 || samMoveDY !== 0;

  if (samMask) {
    const imgData = samCtx.createImageData(w, h);
    const px = imgData.data;
    if (moved) {
      // dim red "ghost" marking where the selection is moving from
      for (let i = 0; i < w * h; i++) {
        if (!samMask[i]) continue;
        const p = i * 4;
        px[p] = 255;
        px[p + 1] = 107;
        px[p + 2] = 107;
        px[p + 3] = 55;
      }
    }
    // highlight at the current (possibly offset) position
    for (let i = 0; i < w * h; i++) {
      if (!samMask[i]) continue;
      const y = (i / w) | 0;
      const x = i % w;
      const dx = x + samMoveDX, dy = y + samMoveDY;
      if (dx < 0 || dx >= w || dy < 0 || dy >= h) continue;
      const p = (dy * w + dx) * 4;
      px[p] = 34;
      px[p + 1] = 211;
      px[p + 2] = 238;
      px[p + 3] = 130;
    }
    samCtx.putImageData(imgData, 0, 0);
  }

  const rect = samOverlay.getBoundingClientRect();
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
    // SAM's box prompt is a strong hint, not a hard constraint -- it can
    // occasionally bleed a few pixels past the drawn box. Clip the mask to
    // the box so nothing outside it is ever picked up.
    if (samBox) {
      const bx0 = Math.floor(samBox.x0), bx1 = Math.ceil(samBox.x1);
      const by0 = Math.floor(samBox.y0), by1 = Math.ceil(samBox.y1);
      for (let y = 0; y < mh; y++) {
        if (y >= by0 && y <= by1) continue;
        const rowStart = y * mw;
        for (let x = 0; x < mw; x++) maskArr[rowStart + x] = 0;
      }
      for (let y = Math.max(0, by0); y <= Math.min(mh - 1, by1); y++) {
        const rowStart = y * mw;
        for (let x = 0; x < bx0; x++) maskArr[rowStart + x] = 0;
        for (let x = bx1 + 1; x < mw; x++) maskArr[rowStart + x] = 0;
      }
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

  let hasAny = false;
  for (let i = 0; i < samMask.length; i++) {
    if (samMask[i]) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) {
    deactivateBoxSelect();
    return;
  }

  const firstExtraction = !hasResult;
  const isolate = firstExtraction || samIsolateCheckbox.checked;
  const dx = Math.round(samMoveDX), dy = Math.round(samMoveDY);
  const moved = dx !== 0 || dy !== 0;

  pushUndo();
  const before = ctxWorking.getImageData(0, 0, w, h);
  const beforeBuf = before.data;
  const orig = originalImageData.data;
  const srcBuf = firstExtraction ? orig : beforeBuf;

  // Isolate starts from a blank canvas (everything not the selection gets
  // cleared); otherwise we start from a copy of the current canvas so
  // untouched pixels stay exactly as they were.
  const out = isolate ? ctxWorking.createImageData(w, h) : new ImageData(new Uint8ClampedArray(beforeBuf), w, h);
  const outBuf = out.data;
  const erase = currentTool === "erase";

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!samMask[i]) continue;
      const p = i * 4;
      if (moved) {
        // always cut the original spot away when relocating, then paste at the new spot
        outBuf[p] = 0;
        outBuf[p + 1] = 0;
        outBuf[p + 2] = 0;
        outBuf[p + 3] = 0;
        const tx = x + dx, ty = y + dy;
        if (tx >= 0 && tx < w && ty >= 0 && ty < h) {
          const tp = (ty * w + tx) * 4;
          outBuf[tp] = srcBuf[p];
          outBuf[tp + 1] = srcBuf[p + 1];
          outBuf[tp + 2] = srcBuf[p + 2];
          outBuf[tp + 3] = srcBuf[p + 3];
        }
      } else if (isolate) {
        outBuf[p] = srcBuf[p];
        outBuf[p + 1] = srcBuf[p + 1];
        outBuf[p + 2] = srcBuf[p + 2];
        outBuf[p + 3] = srcBuf[p + 3];
      } else if (erase) {
        outBuf[p] = 0;
        outBuf[p + 1] = 0;
        outBuf[p + 2] = 0;
        outBuf[p + 3] = 0;
      } else {
        outBuf[p] = orig[p];
        outBuf[p + 1] = orig[p + 1];
        outBuf[p + 2] = orig[p + 2];
        outBuf[p + 3] = orig[p + 3];
      }
    }
  }

  ctxWorking.putImageData(out, 0, 0);

  if (firstExtraction) {
    baselineImageData = ctxWorking.getImageData(0, 0, w, h);
    hasResult = true;
    saveActiveLayerGlobals();
    refreshPanels();
  }

  renderLayerList();
  renderComposite();
  deactivateBoxSelect();
});

samCancelBtn.addEventListener("click", () => {
  deactivateBoxSelect();
});

// ---------- Layer Move / Resize ----------
//
// Unlike Box Select's mask, moving/resizing a whole layer has nothing to
// "refine" -- it takes effect immediately as you drag, no separate Apply
// step. Operates in *scene* space (the layer moves around the shared
// canvas), not layer-local space, so it uses its own point helper rather
// than getCanvasPoint().

function getScenePoint(evt) {
  const rect = sceneCanvas.getBoundingClientRect();
  const scaleX = sceneCanvas.width / rect.width;
  const scaleY = sceneCanvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

function layerHandleRect(L) {
  const size = 16;
  const cx = L.x + L.canvas.width * L.scale;
  const cy = L.y + L.canvas.height * L.scale;
  return { x: cx - size / 2, y: cy - size / 2, size };
}

function pointInHandle(L, p) {
  const r = layerHandleRect(L);
  return p.x >= r.x && p.x <= r.x + r.size && p.y >= r.y && p.y <= r.y + r.size;
}

function pointInLayerBox(L, p) {
  return (
    p.x >= L.x &&
    p.x <= L.x + L.canvas.width * L.scale &&
    p.y >= L.y &&
    p.y <= L.y + L.canvas.height * L.scale
  );
}

function positionLayerOverlay() {
  const wrapRect = canvasWrap.getBoundingClientRect();
  const sceneRect = sceneCanvas.getBoundingClientRect();
  layerOverlay.width = sceneCanvas.width;
  layerOverlay.height = sceneCanvas.height;
  layerOverlay.style.left = sceneRect.left - wrapRect.left + canvasWrap.scrollLeft + "px";
  layerOverlay.style.top = sceneRect.top - wrapRect.top + canvasWrap.scrollTop + "px";
  layerOverlay.style.width = sceneRect.width + "px";
  layerOverlay.style.height = sceneRect.height + "px";
}

function drawLayerOverlay() {
  layerCtx.clearRect(0, 0, layerOverlay.width, layerOverlay.height);
  if (activeLayerIndex < 0) return;
  const L = activeLayer();
  const rect = sceneCanvas.getBoundingClientRect();
  const bitmapToScreen = layerOverlay.width / (rect.width || layerOverlay.width);

  layerCtx.save();
  layerCtx.strokeStyle = "#22d3ee";
  layerCtx.lineWidth = Math.max(1, 2 * bitmapToScreen);
  layerCtx.setLineDash([6 * bitmapToScreen, 4 * bitmapToScreen]);
  layerCtx.strokeRect(L.x, L.y, L.canvas.width * L.scale, L.canvas.height * L.scale);
  layerCtx.restore();

  const handle = layerHandleRect(L);
  layerCtx.fillStyle = "#22d3ee";
  layerCtx.fillRect(handle.x, handle.y, handle.size, handle.size);
  layerCtx.strokeStyle = "#0c0f14";
  layerCtx.lineWidth = Math.max(1, 1.5 * bitmapToScreen);
  layerCtx.strokeRect(handle.x, handle.y, handle.size, handle.size);
}

function activateLayerTransform() {
  if (activeLayerIndex < 0) return;
  activeTool = "layerTransform";
  updatePrimaryToolUI();
  brushCursor.hidden = true;
  sceneCanvas.style.cursor = "move";
  layerOverlay.hidden = false;
  positionLayerOverlay();
  drawLayerOverlay();
  setStatus("Drag inside the box to move the layer, or its corner handle to resize.");
}

function deactivateLayerTransform() {
  activeTool = "touchup";
  layerDragMode = null;
  updatePrimaryToolUI();
  layerOverlay.hidden = true;
  sceneCanvas.style.cursor = "";
  layerCtx.clearRect(0, 0, layerOverlay.width, layerOverlay.height);
  if (hasResult) {
    setStatus('Pick Erase or Restore, then Brush (precise) or Magic Wand (click a whole same-color area) below.');
  }
}

// ---------- Zoom ----------

function applyZoom() {
  if (!hasImage) return;
  const fitWidth = Math.min(canvasWrap.clientWidth, sceneCanvas.width);
  const displayWidth = fitWidth * zoom;
  const displayHeight = displayWidth * (sceneCanvas.height / sceneCanvas.width);
  sceneCanvas.style.width = displayWidth + "px";
  sceneCanvas.style.height = displayHeight + "px";
  zoomIndicator.hidden = false;
  zoomIndicator.textContent = Math.round(zoom * 100) + "%";
  updateCursorSize();
  if (activeTool === "boxSelect") {
    positionSamOverlay();
    drawSamOverlay();
  }
  if (activeTool === "layerTransform") {
    positionLayerOverlay();
    drawLayerOverlay();
  }
}

// Scrolls so the scene's own center (where layers are centered by default,
// see loadImageFile/pushNewLayer) sits in the middle of the viewport. This
// is what resetZoom used to get wrong -- it scrolled to (0,0), the scene's
// top-left corner -- which, since the scene is deliberately padded larger
// than any one photo, is mostly empty space. Zooming in from that corner
// is exactly what looked like "zoom drifts to one side and layers vanish."
function centerViewOnScene() {
  const sceneRect = sceneCanvas.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const sceneDisplayScale = (sceneRect.width / sceneCanvas.width) || 1;
  const centerX = (sceneCanvas.width / 2) * sceneDisplayScale;
  const centerY = (sceneCanvas.height / 2) * sceneDisplayScale;
  canvasWrap.scrollLeft = centerX - wrapRect.width / 2;
  canvasWrap.scrollTop = centerY - wrapRect.height / 2;
}

function resetZoom() {
  zoom = 1;
  applyZoom();
  centerViewOnScene();
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

    // Anchor on the *viewport's own center*, not the cursor. Cursor-anchored
    // zoom drifts toward wherever the mouse happens to be at each tick --
    // with the scene padded larger than any one photo/layer, that drift can
    // walk the view into empty space over repeated zoom steps, which is
    // exactly what reads as "zoom goes to one side and my layers vanish."
    // Anchoring on the current view's own center is stable and predictable
    // regardless of mouse position, and still respects wherever you've
    // manually panned to (it's not re-centering on the scene, just staying
    // put on whatever's already centered in view).
    const wrapRect = canvasWrap.getBoundingClientRect();
    const viewCenterX = wrapRect.width / 2;
    const viewCenterY = wrapRect.height / 2;
    const anchorX = viewCenterX + canvasWrap.scrollLeft;
    const anchorY = viewCenterY + canvasWrap.scrollTop;
    const scaleRatio = zoom / oldZoom;

    applyZoom();

    canvasWrap.scrollLeft = anchorX * scaleRatio - viewCenterX;
    canvasWrap.scrollTop = anchorY * scaleRatio - viewCenterY;
    updateCursorPosition(e);
  },
  { passive: false }
);

// The canvas-only handler above only fires while the pointer is over the
// canvas. A pinch gesture (or Ctrl+scroll) that starts there but drifts
// off it mid-gesture -- easy to do with a large canvas -- would otherwise
// fall through to the browser's native page zoom, which zooms everything
// including the sidebar and can push tool panels off-screen. Block that
// globally regardless of where on the page it happens.
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false }
);

zoomIndicator.addEventListener("click", resetZoom);

// Both sidebars scroll internally so reaching lower panels never requires
// scrolling the whole page -- max-height alone can't account for the
// topbar's actual height (it varies with content/viewport), so this sizes
// them to exactly what's left below wherever they naturally sit.
const sidebarEls = document.querySelectorAll(".sidebar, .layers-sidebar");
function fitSidebarHeight() {
  sidebarEls.forEach((el) => {
    const top = el.getBoundingClientRect().top;
    el.style.maxHeight = Math.max(200, window.innerHeight - top - 20) + "px";
  });
}
fitSidebarHeight();

// ---------- Theme color ----------
//
// One picker drives the whole app's accent color (buttons, active states,
// highlights) via the existing --accent/--accent-hover CSS custom
// properties every style already reads from -- no per-button styling
// needed. Persisted so it survives a reload.

function lightenHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return "#" + [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function applyThemeColor(hex) {
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-hover", lightenHex(hex, 0.4));
}

const THEME_COLOR_KEY = "cirnoBrThemeColor";
const savedThemeColor = localStorage.getItem(THEME_COLOR_KEY);
if (savedThemeColor) {
  themeColorInput.value = savedThemeColor;
  applyThemeColor(savedThemeColor);
}
themeColorInput.addEventListener("input", () => {
  applyThemeColor(themeColorInput.value);
  localStorage.setItem(THEME_COLOR_KEY, themeColorInput.value);
});

window.addEventListener("resize", () => {
  updateCursorSize();
  applyZoom();
  fitSidebarHeight();
});

// ---------- Undo / redo / reset ----------

undoBtn.addEventListener("click", () => {
  if (undoStack.length === 0) return;
  const current = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  redoStack.push(current);
  const prev = undoStack.pop();
  ctxWorking.putImageData(prev, 0, 0);
  updateUndoRedoButtons();
  renderComposite();
});

redoBtn.addEventListener("click", () => {
  if (redoStack.length === 0) return;
  const current = ctxWorking.getImageData(0, 0, workingCanvas.width, workingCanvas.height);
  undoStack.push(current);
  const next = redoStack.pop();
  ctxWorking.putImageData(next, 0, 0);
  updateUndoRedoButtons();
  renderComposite();
});

resetBtn.addEventListener("click", () => {
  if (!baselineImageData) return;
  if (!confirm("Discard all touch-ups and reset to the AI result?")) return;
  pushUndo();
  ctxWorking.putImageData(baselineImageData, 0, 0);
  renderComposite();
});

// ---------- Export / new image ----------

downloadBtn.addEventListener("click", () => {
  sceneCanvas.toBlob((blob) => {
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

newImageBtn.addEventListener("click", resetAllLayers);

updateCursorSize();
updateBoxSelectHint();
renderLayerList();
