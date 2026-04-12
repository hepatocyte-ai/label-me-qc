/* ===== State ===== */
let userName = "";
let jData = null;
let idx = 0;
let vals = {};
let allValsByFile = {};
let showImg = true;
let availableFiles = [];
let saveDirHandle = null;
let currentFileName = "";
let fileAutosaveTimer = null;
const img = new Image();

const LC = {
  steatosis: "#f85149",
  mesenchymal_cells: "#58a6ff",
  normal: "#3fb950",
  non_nuclear: "#d29922",
  balloon_dystrophy: "#bc8cff",
};

const MIME_BY_EXT = { jpg: "jpeg", jpeg: "jpeg", png: "png", bmp: "bmp", gif: "gif" };

const $ = (id) => document.getElementById(id);

/* ===== Init ===== */
window.addEventListener("DOMContentLoaded", () => {
  $("btnLogin").addEventListener("click", login);
  $("nameInput").addEventListener("keydown", (e) => e.key === "Enter" && login());

  $("btnExport").addEventListener("click", exportXLSX);
  $("btnExportJSON").addEventListener("click", exportCorrectedJSON);
  $("btnBack").addEventListener("click", backToUpload);

  $("jsonFileInput").addEventListener("change", loadFile);
  $("folderInput").addEventListener("change", loadFolder);

  $("uploadBox").addEventListener("click", () => $("jsonFileInput").click());
  $("uploadBox").addEventListener("dragover", (e) => {
    e.preventDefault();
    $("uploadBox").classList.add("over");
  });
  $("uploadBox").addEventListener("dragleave", () => $("uploadBox").classList.remove("over"));
  $("uploadBox").addEventListener("drop", handleDrop);

  $("btnPrev").addEventListener("click", () => navigate(-1));
  $("btnNext").addEventListener("click", () => navigate(1));
  $("btnLast").addEventListener("click", goToLast);
  $("btnJump").addEventListener("click", jumpTo);
  $("jumpInput").addEventListener("keydown", (e) => e.key === "Enter" && jumpTo());
  $("btnOpenList").addEventListener("click", openList);

  $("btnCloseList").addEventListener("click", closeList);
  $("listModal").addEventListener("click", (e) => e.target === $("listModal") && closeList());
  $("listSearch").addEventListener("input", renderList);
  $("listSearch").addEventListener("keydown", (e) => e.key === "Escape" && closeList());

  document.querySelectorAll(".lbtn").forEach((b) => {
    b.addEventListener("click", () => setLabel(b.dataset.l));
  });

  document.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("resize", debounce(() => jData && updateUI(), 120));

  $("btnPickSaveDir").addEventListener("click", pickSaveDir);

  $("btnOpenInstr").addEventListener("click", () => {
    window.open("instruction.html", "_blank");
  });

  // Restore session on page reload
  const savedUser = localStorage.getItem("cv_current_user");
  if (savedUser) {
    $("nameInput").value = savedUser;
    login();
  }
});

/* ===== Login ===== */
function login() {
  const n = $("nameInput").value.trim();
  if (!n) {
    $("nameInput").classList.add("err");
    return;
  }

  userName = n;
  localStorage.setItem("cv_current_user", n); // persist session across page reloads
  $("loginScreen").style.display = "none";
  $("appScreen").style.display = "flex";
  $("vName").textContent = n;

  try {
    const s = localStorage.getItem("cv_" + n);
    if (s) {
      vals = JSON.parse(s).vals || {};
      toast(`Labels restored: ${Object.keys(vals).length}`);
    }
  } catch (_) {}

  loadFileList();
}

/* ===== File list loading ===== */
async function loadFileList() {
  if (location.protocol === "file:") {
    toast('In file:// mode: use the "📁 Annotations Folder" button to select a folder');
    return;
  }

  try {
    const response = await fetch("annotations/");
    if (!response.ok) return;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = [...doc.querySelectorAll("a")];

    availableFiles = links
      .map((a) => a.getAttribute("href"))
      .filter((href) => href && href.toLowerCase().endsWith(".json") && !href.startsWith("?"))
      .map((href) => ({
        displayName: decodeURIComponent(href.split("/").pop()),
        type: "remote",
        url: "annotations/" + href,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    renderFileList();
  } catch (e) {
    console.warn("Failed to load file list:", e);
    toast("Could not retrieve list from annotations/ folder");
  }
}

function loadFolder(e) {
  const files = Array.from(e.target.files || []);
  availableFiles = files
    .filter((f) => f.name.toLowerCase().endsWith(".json"))
    .map((f) => ({ displayName: f.name, type: "local", file: f }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  renderFileList();
  toast(availableFiles.length
    ? `Found ${availableFiles.length} JSON file(s)`
    : "No JSON files found in folder");
}

/* ===== Render list ===== */
function renderFileList() {
  const container = $("fileListContainer");
  const itemsDiv = $("fileListItems");

  if (!availableFiles.length) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  itemsDiv.innerHTML = "";

  for (const fileEntry of availableFiles) {
    const item = document.createElement("div");
    item.className = "file-item";
    item.textContent = fileEntry.displayName;
    item.title = fileEntry.displayName;
    item.addEventListener("click", () => loadAnnotationFile(fileEntry, item));
    itemsDiv.appendChild(item);
  }
}

/* ===== Load selected file from list ===== */
async function loadAnnotationFile(fileEntry, itemEl) {
  const originalText = itemEl.textContent;
  itemEl.classList.add("loading");
  itemEl.innerHTML = `<span class="loading-spinner"></span>${originalText}`;

  try {
    let data;
    if (fileEntry.type === "local") {
      const text = await fileEntry.file.text();
      data = JSON.parse(text);
    } else {
      const response = await fetch(fileEntry.url);
      if (!response.ok) throw new Error("File not found");
      data = await response.json();
    }

    if (!data.shapes) throw new Error("Missing 'shapes' field");
    await openData(data, fileEntry.displayName);
  } catch (err) {
    toast("Error: " + err.message);
  } finally {
    itemEl.classList.remove("loading");
    itemEl.textContent = originalText;
  }
}

/* ===== Manual upload ===== */
function handleDrop(e) {
  e.preventDefault();
  $("uploadBox").classList.remove("over");
  const f = e.dataTransfer.files?.[0];
  if (!f || !f.name.toLowerCase().endsWith(".json")) {
    toast("Please drop a .json file");
    return;
  }
  readJsonFile(f);
}

function loadFile(e) {
  const f = e.target.files?.[0];
  if (f) readJsonFile(f);
  e.target.value = "";
}

function readJsonFile(file) {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.shapes) throw new Error("Missing 'shapes' field");
      await openData(data, file.name);
    } catch (err) {
      toast("Parse error: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ===== Open JSON data ===== */
async function openData(data, fileName) {
  jData = data;
  idx = 0;
  currentFileName = fileName;
  vals = {}; // progress is tracked separately for each JSON file

  // Load from localStorage first
  try {
    const k = lsKey();
    const s = localStorage.getItem(k);
    if (s) vals = JSON.parse(s).vals || {};
  } catch (_) {}

  // Load from file if save folder is selected (takes priority over localStorage)
  await loadProgressFromFile();

  allValsByFile[currentFileName] = { ...vals };

  const ext = (data.imagePath || "img.jpg").split(".").pop().toLowerCase();
  const mime = MIME_BY_EXT[ext] || "jpeg";

  if (data.imageData) {
    await new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => {
        toast("Error loading imageData");
        resolve();
      };
      img.src = data.imageData.startsWith("data:")
        ? data.imageData
        : `data:image/${mime};base64,${data.imageData}`;
    });
  } else {
    img.src = "";
    toast("No imageData field — showing outlines only");
  }

  initViewer(fileName);
}

function initViewer(fileName) {
  $("uploadArea").style.display = "none";
  $("mainContent").style.display = "flex";
  $("progWrap").style.display = "block";
  $("btnBack").style.display = "inline-block";

  const n = jData.shapes.length;
  const iw = jData.imageWidth || img.naturalWidth || "?";
  const ih = jData.imageHeight || img.naturalHeight || "?";

  $("navTotal").textContent = n;
  $("jumpInput").max = n;
  $("fileInfo").textContent = `${fileName} · ${n} cells · ${iw}×${ih}`;

  updateUI();
}

function backToUpload() {
  jData = null;
  idx = 0;
  $("uploadArea").style.display = "flex";
  $("mainContent").style.display = "none";
  $("progWrap").style.display = "none";
  $("btnBack").style.display = "none";
}

/* ===== UI ===== */
function toggleImage() {
  showImg = !showImg;
  $("imgPanel").classList.toggle("hidden", !showImg);
  $("mainContent").classList.toggle("img-hidden", !showImg);
  $("btnToggleImg").textContent = showImg ? "🖼 Hide image" : "🖼 Show image";

  if (jData) {
    requestAnimationFrame(() => drawZoom(jData.shapes[idx]));
  }
}

function updateUI() {
  if (!jData) return;

  const shape = jData.shapes[idx];
  const total = jData.shapes.length;
  const labeled = Object.keys(vals).length;
  const curVal = vals[idx];

  $("navCur").textContent = idx + 1;
  $("btnPrev").disabled = idx === 0;
  $("btnNext").disabled = idx === total - 1;

  const pct = total ? ((labeled / total) * 100).toFixed(1) : "0.0";
  $("pFill").style.width = `${pct}%`;
  $("progText").textContent = `${labeled} / ${total} (${pct}%)`;

  $("iIdx").textContent = `#${idx + 1}`;

  const li = lastLabeledIdx();
  $("btnLast").disabled = li === null;
  $("btnLast").textContent = li === null ? "⏭ Last labeled" : `⏭ Last labeled (#${li + 1})`;

  if (curVal) {
    const col = LC[curVal.valLabel] || "#aaa";
    $("iVal").innerHTML = `<span class="chip" style="background:${hexA(col, .2)};color:${col};border:1px solid ${hexA(col, .45)}">${curVal.valLabel}</span>`;
  } else {
    $("iVal").innerHTML = `<span class="chip chip-dim">not set</span>`;
  }

  updateBtns(curVal?.valLabel || null);
  drawZoom(shape);
  save();
}

/* ===== Draw ===== */
/*
 * BUG FIX — zoom drift / infinite grow:
 * Previously, prepareCanvas() set canvas.style.width/height explicitly in px,
 * which caused the canvas to expand its flex parent. On the next call,
 * body.clientWidth was larger → canvas grew again → feedback loop.
 *
 * Fix: canvas is now position:absolute;inset:0 (CSS), so it is out of normal
 * flow and cannot affect the parent's clientWidth/clientHeight.
 * We read body dimensions FIRST, then set only the pixel buffer (canvas.width/height).
 * No canvas.style.width/height manipulation needed.
 */
function drawZoom(shape) {
  const canvas = $("zoomCanvas");
  const ctx = canvas.getContext("2d");
  const body = $("zoomBody");

  // body size is stable because canvas is absolutely positioned (out of flow)
  const W = body.clientWidth;
  const H = body.clientHeight;
  if (W < 10 || H < 10) return;

  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);

  // Resize pixel buffer only when dimensions actually change
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }

  // Reset transform to prevent accumulation between redraws
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, pw, ph);
  // Scale subsequent drawing commands from CSS-pixel space to device-pixel space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!img.naturalWidth || !img.complete || !shape?.points?.length) return;

  const pts = shape.points;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = 512;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(img.naturalWidth - sx, maxX - minX + 2 * pad);
  const sh = Math.min(img.naturalHeight - sy, maxY - minY + 2 * pad);
  if (sw <= 0 || sh <= 0) return;

  const sc = Math.min(W / sw, H / sh);
  const dw = sw * sc, dh = sh * sc;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);

  const tpts = pts.map((p) => [dx + (p[0] - sx) * sc, dy + (p[1] - sy) * sc]);
  const col = LC[vals[idx]?.valLabel] || "#ff6b6b";
  drawShape(ctx, tpts, shape.shape_type, 1, col, hexA(col, 0.2), 2);
}

function drawShape(ctx, points, type, sc, stroke, fill, lw) {
  if (!points?.length) return;
  ctx.beginPath();

  if (type === "rectangle" && points.length >= 2) {
    ctx.rect(
      points[0][0] * sc,
      points[0][1] * sc,
      (points[1][0] - points[0][0]) * sc,
      (points[1][1] - points[0][1]) * sc
    );
  } else if (type === "circle" && points.length >= 2) {
    const r = Math.hypot((points[1][0] - points[0][0]) * sc, (points[1][1] - points[0][1]) * sc);
    ctx.arc(points[0][0] * sc, points[0][1] * sc, r, 0, Math.PI * 2);
  } else {
    ctx.moveTo(points[0][0] * sc, points[0][1] * sc);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * sc, points[i][1] * sc);
    ctx.closePath();
  }

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ===== Labels ===== */
function setLabel(val) {
  if (!jData) return;

  const shape = jData.shapes[idx];
  vals[idx] = {
    origLabel: shape.label || "",
    points: shape.points || [],
    shapeType: shape.shape_type || "polygon",
    valLabel: val,
  };
  allValsByFile[currentFileName] = { ...vals };
  updateUI();
  toast(`✓ ${val}`);

  if (idx < jData.shapes.length - 1) {
    setTimeout(() => {
      idx++;
      updateUI();
    }, 250);
  }
}

function updateBtns(activeLabel) {
  document.querySelectorAll(".lbtn").forEach((b) => {
    b.classList.toggle("active", b.dataset.l === activeLabel);
  });
}

/* ===== Navigation ===== */
function navigate(d) {
  if (!jData) return;
  const ni = idx + d;
  if (ni < 0 || ni >= jData.shapes.length) return;
  idx = ni;
  updateUI();
}

function lastLabeledIdx() {
  const keys = Object.keys(vals).map(Number);
  return keys.length ? Math.max(...keys) : null;
}

function goToLast() {
  const li = lastLabeledIdx();
  if (li === null) return toast("No labeled cells yet");
  idx = li;
  updateUI();
  toast(`Navigating to cell #${li + 1}`);
}

function jumpTo() {
  if (!jData) return;
  const v = parseInt($("jumpInput").value, 10);
  if (Number.isNaN(v) || v < 1 || v > jData.shapes.length) {
    toast(`Enter a number between 1 and ${jData.shapes.length}`);
    return;
  }
  idx = v - 1;
  $("jumpInput").value = "";
  updateUI();
}

/* ===== Modal ===== */
function openList() {
  if (!jData) return;
  $("listSearch").value = "";
  renderList();
  $("listModal").classList.add("open");
  $("listSearch").focus();
}

function closeList() {
  $("listModal").classList.remove("open");
}

function renderList() {
  if (!jData) return;
  const q = $("listSearch").value.trim().toLowerCase();
  const ul = $("modalList");
  ul.innerHTML = "";

  jData.shapes.forEach((shape, i) => {
    const v = vals[i];
    const vlabel = v?.valLabel || "";
    const numStr = String(i + 1);

    if (q) {
      const match = numStr.includes(q) ||
        vlabel.toLowerCase().includes(q) ||
        (shape.label || "").toLowerCase().includes(q);
      if (!match) return;
    }

    const div = document.createElement("div");
    div.className = "cell-item" + (i === idx ? " current" : "");
    div.addEventListener("click", () => {
      idx = i;
      updateUI();
      closeList();
    });

    const dot = document.createElement("span");
    dot.className = "ci-dot";
    dot.style.background = vlabel ? LC[vlabel] : "var(--border)";

    const num = document.createElement("span");
    num.className = "ci-num";
    num.textContent = "#" + (i + 1);

    const lbl = document.createElement("span");
    lbl.className = "ci-label";
    lbl.textContent = shape.label || "—";

    const badge = document.createElement("span");
    badge.className = "ci-badge";
    if (vlabel) {
      const col = LC[vlabel];
      badge.textContent = vlabel;
      badge.style.color = col;
      badge.style.background = hexA(col, 0.15);
      badge.style.borderColor = hexA(col, 0.45);
    } else {
      badge.textContent = "not set";
      badge.style.color = "var(--text2)";
      badge.style.background = "var(--bg2)";
      badge.style.borderColor = "var(--border)";
    }

    div.append(dot, num, lbl, badge);
    ul.appendChild(div);
  });

  if (!ul.children.length) {
    ul.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text2)">Nothing found</div>`;
  }

  const cur = ul.querySelector(".current");
  if (cur) cur.scrollIntoView({ block: "center" });
}

/* ===== Keyboard ===== */
function onGlobalKeydown(e) {
  if (e.key === "Escape") {
    closeList();
    return;
  }

  if (!jData) return;
  if (e.target.tagName === "INPUT") return;

  const map = {
    ArrowLeft: () => navigate(-1),
    ArrowRight: () => navigate(1),
    "1": () => setLabel("steatosis"),
    "2": () => setLabel("mesenchymal_cells"),
    "3": () => setLabel("normal"),
    "4": () => setLabel("non_nuclear"),
    "5": () => setLabel("balloon_dystrophy"),
  };

  if (map[e.key]) {
    e.preventDefault();
    map[e.key]();
  }
}

/* ===== Export XLSX ===== */
function exportXLSX() {
  if (!userName) return toast("Please enter validator name first");

  const all = collectAllProgressForUser();
  const fileNames = Object.keys(all).sort((a, b) => a.localeCompare(b));

  const rows = [[
    "Validator Name",
    "File",
    "Cell Index",
    "Contour Coordinates",
    "Original Label",
    "Validator Label",
    "Shape Type",
  ]];

  let totalRows = 0;

  for (const fileName of fileNames) {
    const fileVals = all[fileName] || {};
    const entries = Object.entries(fileVals).sort((a, b) => Number(a[0]) - Number(b[0]));

    for (const [i, v] of entries) {
      const coords = (v.points || [])
        .map((p) => `(${(+p[0]).toFixed(1)};${(+p[1]).toFixed(1)})`)
        .join(" | ") || "—";

      rows.push([
        userName,
        fileName,
        Number(i) + 1,
        coords,
        v.origLabel || "—",
        v.valLabel || "—",
        v.shapeType || "—",
      ]);
      totalRows++;
    }
  }

  if (!totalRows) return toast("No data to export");

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 20 }, // Validator Name
    { wch: 32 }, // File
    { wch: 14 }, // Cell Index
    { wch: 90 }, // Contour Coordinates
    { wch: 24 }, // Original Label
    { wch: 24 }, // Validator Label
    { wch: 14 }, // Shape Type
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Validations");
  XLSX.writeFile(wb, `validation_${userName}_${new Date().toISOString().slice(0, 10)}.xlsx`);

  toast(`✓ Exported ${totalRows} record(s) from ${fileNames.length} file(s)`);
}

/* ===== Export Corrected JSON ===== */
function exportCorrectedJSON() {
  if (!jData) return toast("No file loaded");

  const validatedCount = Object.keys(vals).length;
  if (!validatedCount) return toast("No labels assigned yet");

  // Deep-copy the original data to preserve all original fields intact
  const corrected = JSON.parse(JSON.stringify(jData));

  // Replace 'label' only for shapes that have been validated
  let correctedCount = 0;
  for (const [idxStr, val] of Object.entries(vals)) {
    const i = Number(idxStr);
    if (corrected.shapes[i] && val.valLabel) {
      corrected.shapes[i].label = val.valLabel;
      correctedCount++;
    }
  }

  const fileName = currentFileName.replace(/\.json$/i, "_corrected.json");
  const blob = new Blob([JSON.stringify(corrected, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast(`✓ Exported JSON with ${correctedCount} corrected label(s)`);
}

/* ===== Utils ===== */
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function lsKey() {
  return `cv_${userName}__${currentFileName || "no_file"}`;
}

function save() {
  if (!userName) return;

  allValsByFile[currentFileName] = { ...vals };

  try {
    localStorage.setItem(lsKey(), JSON.stringify({ vals, ts: Date.now() }));
  } catch (_) {}

  scheduleFileSave();
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function safeName(s) {
  return String(s || "unknown").replace(/[^\p{L}\p{N}\-_\.]+/gu, "_");
}

function progressFileName() {
  const base = safeName(currentFileName.replace(/\.json$/i, ""));
  const user = safeName(userName);
  return `${base}__${user}.validation.json`;
}

async function pickSaveDir() {
  if (!window.showDirectoryPicker) {
    toast("Your browser doesn't support folder write access (use Chrome or Edge)");
    return;
  }

  try {
    saveDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    toast("Save folder selected");
    if (jData && currentFileName) {
      await loadProgressFromFile();
      updateUI();
      await persistToFile();
    }
  } catch {
    // User cancelled the picker
  }
}

async function persistToFile() {
  if (!saveDirHandle || !userName || !currentFileName) return;

  const payload = {
    version: 1,
    userName,
    sourceFile: currentFileName,
    savedAt: new Date().toISOString(),
    vals
  };

  const fh = await saveDirHandle.getFileHandle(progressFileName(), { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

function scheduleFileSave() {
  clearTimeout(fileAutosaveTimer);
  fileAutosaveTimer = setTimeout(() => {
    persistToFile().catch((e) => {
      console.warn("Auto-save to file failed:", e);
    });
  }, 200);
}

async function loadProgressFromFile() {
  if (!saveDirHandle || !currentFileName) return;

  try {
    const fh = await saveDirHandle.getFileHandle(progressFileName(), { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (parsed && parsed.vals && typeof parsed.vals === "object") {
      vals = parsed.vals;
      allValsByFile[currentFileName] = { ...vals };
      toast(`Progress loaded from file: ${Object.keys(vals).length} label(s)`);
    }
  } catch {
    // File does not exist yet — that's fine
  }
}

function collectAllProgressForUser() {
  const result = {};

  // 1) In-memory progress from the current session
  for (const [fileName, fileVals] of Object.entries(allValsByFile)) {
    if (fileVals && Object.keys(fileVals).length) {
      result[fileName] = { ...fileVals };
    }
  }

  // 2) Per-file progress persisted in localStorage
  const prefix = `cv_${userName}__`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;

    const fileName = k.slice(prefix.length) || "no_file";
    try {
      const parsed = JSON.parse(localStorage.getItem(k));
      if (parsed?.vals && typeof parsed.vals === "object") {
        result[fileName] = { ...(result[fileName] || {}), ...parsed.vals };
      }
    } catch (_) {}
  }

  return result;
}

// General-purpose canvas sizing helper (kept for potential future use)
function prepareCanvas(canvas, ctx, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}