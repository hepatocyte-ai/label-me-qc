/* ===== State (refactored into class) ===== */

const LC = {
  steatosis: "#f85149",
  mesenchymal_cells: "#58a6ff",
  normal: "#3fb950",
  non_nuclear: "#d29922",
  balloon_dystrophy: "#bc8cff",
};

const MIME_BY_EXT = { jpg: "jpeg", jpeg: "jpeg", png: "png", bmp: "bmp", gif: "gif" };

const $ = (id) => document.getElementById(id);

class ValidatorApp {
  constructor() {
    this.userName = "";
    this.jData = null;
    this.idx = 0;
    this.vals = {};
    this.allValsByFile = {};
    this.showImg = true;
    this.availableFiles = [];
    this.saveDirHandle = null;
    this.currentFileName = "";
    this.fileAutosaveTimer = null;
    this.img = new Image();
  }

  /* ===== Init ===== */
  init() {
    $("btnLogin").addEventListener("click", this.login.bind(this));
    $("nameInput").addEventListener("keydown", (e) => e.key === "Enter" && this.login());

    $("btnExport").addEventListener("click", this.exportXLSX.bind(this));
    $("btnExportJSON").addEventListener("click", this.exportCorrectedJSON.bind(this));
    $("btnBack").addEventListener("click", this.backToUpload.bind(this));

    $("jsonFileInput").addEventListener("change", this.loadFile.bind(this));
    $("folderInput").addEventListener("change", this.loadFolder.bind(this));

    $("uploadBox").addEventListener("click", () => $("jsonFileInput").click());
    $("uploadBox").addEventListener("dragover", (e) => {
      e.preventDefault();
      $("uploadBox").classList.add("over");
    });
    $("uploadBox").addEventListener("dragleave", () => $("uploadBox").classList.remove("over"));
    $("uploadBox").addEventListener("drop", this.handleDrop.bind(this));

    $("btnPrev").addEventListener("click", () => this.navigate(-1));
    $("btnNext").addEventListener("click", () => this.navigate(1));
    $("btnLast").addEventListener("click", this.goToLast.bind(this));
    $("btnJump").addEventListener("click", this.jumpTo.bind(this));
    $("jumpInput").addEventListener("keydown", (e) => e.key === "Enter" && this.jumpTo());
    $("btnOpenList").addEventListener("click", this.openList.bind(this));

    $("btnCloseList").addEventListener("click", this.closeList.bind(this));
    $("listModal").addEventListener("click", (e) => e.target === $("listModal") && this.closeList());
    $("listSearch").addEventListener("input", this.renderList.bind(this));
    $("listSearch").addEventListener("keydown", (e) => e.key === "Escape" && this.closeList());

    document.querySelectorAll(".lbtn").forEach((b) => {
      b.addEventListener("click", () => this.setLabel(b.dataset.l));
    });

    document.addEventListener("keydown", this.onGlobalKeydown.bind(this));
    window.addEventListener("resize", debounce(() => this.jData && this.updateUI(), 120));

    $("btnPickSaveDir").addEventListener("click", this.pickSaveDir.bind(this));

    $("btnOpenInstr").addEventListener("click", () => {
      window.open("instruction.html", "_blank");
    });

    // Restore session on page reload
    const savedUser = localStorage.getItem("cv_current_user");
    if (savedUser) {
      $("nameInput").value = savedUser;
      this.login();
    }
  }

  /* ===== Login ===== */
  login() {
    const n = $("nameInput").value.trim();
    if (!n) {
      $("nameInput").classList.add("err");
      return;
    }

    this.userName = n;
    localStorage.setItem("cv_current_user", n);
    $("loginScreen").style.display = "none";
    $("appScreen").style.display = "flex";
    $("vName").textContent = n;

    try {
      const s = localStorage.getItem("cv_" + n);
      if (s) {
        this.vals = JSON.parse(s).vals || {};
        toast(`Labels restored: ${Object.keys(this.vals).length}`);
      }
    } catch (_) {}

    this.loadFileList();
  }

  /* ===== File list loading ===== */
  async loadFileList() {
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

      this.availableFiles = links
        .map((a) => a.getAttribute("href"))
        .filter((href) => href && href.toLowerCase().endsWith(".json") && !href.startsWith("?"))
        .map((href) => ({
          displayName: decodeURIComponent(href.split("/").pop()),
          type: "remote",
          url: "annotations/" + href,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      this.renderFileList();
    } catch (e) {
      console.warn("Failed to load file list:", e);
      toast("Could not retrieve list from annotations/ folder");
    }
  }

  loadFolder(e) {
    const files = Array.from(e.target.files || []);
    this.availableFiles = files
      .filter((f) => f.name.toLowerCase().endsWith(".json"))
      .map((f) => ({ displayName: f.name, type: "local", file: f }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    this.renderFileList();
    toast(this.availableFiles.length
      ? `Found ${this.availableFiles.length} JSON file(s)`
      : "No JSON files found in folder");
  }

  /* ===== Render list ===== */
  renderFileList() {
    const container = $("fileListContainer");
    const itemsDiv = $("fileListItems");

    if (!this.availableFiles.length) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    itemsDiv.innerHTML = "";

    for (const fileEntry of this.availableFiles) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.textContent = fileEntry.displayName;
      item.title = fileEntry.displayName;
      item.addEventListener("click", () => this.loadAnnotationFile(fileEntry, item));
      itemsDiv.appendChild(item);
    }
  }

  /* ===== Load selected file from list ===== */
  async loadAnnotationFile(fileEntry, itemEl) {
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
      await this.openData(data, fileEntry.displayName);
    } catch (err) {
      toast("Error: " + err.message);
    } finally {
      itemEl.classList.remove("loading");
      itemEl.textContent = originalText;
    }
  }

  /* ===== Manual upload ===== */
  handleDrop(e) {
    e.preventDefault();
    $("uploadBox").classList.remove("over");
    const f = e.dataTransfer.files?.[0];
    if (!f || !f.name.toLowerCase().endsWith(".json")) {
      toast("Please drop a .json file");
      return;
    }
    this.readJsonFile(f);
  }

  loadFile(e) {
    const f = e.target.files?.[0];
    if (f) this.readJsonFile(f);
    e.target.value = "";
  }

  readJsonFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.shapes) throw new Error("Missing 'shapes' field");
        await this.openData(data, file.name);
      } catch (err) {
        toast("Parse error: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ===== Open JSON data ===== */
  async openData(data, fileName) {
    this.jData = data;
    this.idx = 0;
    this.currentFileName = fileName;
    this.vals = {};

    try {
      const k = this.lsKey();
      const s = localStorage.getItem(k);
      if (s) this.vals = JSON.parse(s).vals || {};
    } catch (_) {}

    await this.loadProgressFromFile();

    this.allValsByFile[this.currentFileName] = { ...this.vals };

    const ext = (data.imagePath || "img.jpg").split(".").pop().toLowerCase();
    const mime = MIME_BY_EXT[ext] || "jpeg";

    if (data.imageData) {
      await new Promise((resolve) => {
        this.img.onload = () => resolve();
        this.img.onerror = () => {
          toast("Error loading imageData");
          resolve();
        };
        this.img.src = data.imageData.startsWith("data:")
          ? data.imageData
          : `data:image/${mime};base64,${data.imageData}`;
      });
    } else {
      this.img.src = "";
      toast("No imageData field — showing outlines only");
    }

    this.initViewer(fileName);
  }

  initViewer(fileName) {
    $("uploadArea").style.display = "none";
    $("mainContent").style.display = "flex";
    $("progWrap").style.display = "block";
    $("btnBack").style.display = "inline-block";

    const n = this.jData.shapes.length;
    const iw = this.jData.imageWidth || this.img.naturalWidth || "?";
    const ih = this.jData.imageHeight || this.img.naturalHeight || "?";

    $("navTotal").textContent = n;
    $("jumpInput").max = n;
    $("fileInfo").textContent = `${fileName} · ${n} cells · ${iw}×${ih}`;

    this.updateUI();
  }

  backToUpload() {
    this.jData = null;
    this.idx = 0;
    $("uploadArea").style.display = "flex";
    $("mainContent").style.display = "none";
    $("progWrap").style.display = "none";
    $("btnBack").style.display = "none";
  }

  /* ===== UI ===== */
  toggleImage() {
    this.showImg = !this.showImg;
    $("imgPanel").classList.toggle("hidden", !this.showImg);
    $("mainContent").classList.toggle("img-hidden", !this.showImg);
    $("btnToggleImg").textContent = this.showImg ? "🖼 Hide image" : "🖼 Show image";

    if (this.jData) {
      requestAnimationFrame(() => this.drawZoom(this.jData.shapes[this.idx]));
    }
  }

  updateUI() {
    if (!this.jData) return;

    const shape = this.jData.shapes[this.idx];
    const total = this.jData.shapes.length;
    const labeled = Object.keys(this.vals).length;
    const curVal = this.vals[this.idx];

    $("navCur").textContent = this.idx + 1;
    $("btnPrev").disabled = this.idx === 0;
    $("btnNext").disabled = this.idx === total - 1;

    const pct = total ? ((labeled / total) * 100).toFixed(1) : "0.0";
    $("pFill").style.width = `${pct}%`;
    $("progText").textContent = `${labeled} / ${total} (${pct}%)`;

    $("iIdx").textContent = `#${this.idx + 1}`;

    const li = this.lastLabeledIdx();
    $("btnLast").disabled = li === null;
    $("btnLast").textContent = li === null ? "⏭ Last labeled" : `⏭ Last labeled (#${li + 1})`;

    if (curVal) {
      const col = LC[curVal.valLabel] || "#aaa";
      $("iVal").innerHTML = `<span class="chip" style="background:${hexA(col, .2)};color:${col};border:1px solid ${hexA(col, .45)}">${curVal.valLabel}</span>`;
    } else {
      $("iVal").innerHTML = `<span class="chip chip-dim">not set</span>`;
    }

    this.updateBtns(curVal?.valLabel || null);
    this.drawZoom(shape);
    this.save();
  }

  /* ===== Draw ===== */
drawZoom(shape) {
  const canvas = $("zoomCanvas");
  const ctx = canvas.getContext("2d");
  const body = $("zoomBody");

  const W = body.clientWidth;
  const H = body.clientHeight;
  if (W < 10 || H < 10) return;

  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);

  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, pw, ph);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!this.img.naturalWidth || !this.img.complete || !shape?.points?.length) return;

  const pts = shape.points;
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const desiredPad = Math.min(800, Math.max(256, Math.max(boxW, boxH) * 0.2));

  // Центр bounding box клетки
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Желаемая область вокруг центра (симметричная)
  const targetW = boxW + 2 * desiredPad;
  const targetH = boxH + 2 * desiredPad;
  const halfW = targetW / 2;
  const halfH = targetH / 2;

  // Границы желаемой области в координатах изображения
  let srcX = centerX - halfW;
  let srcY = centerY - halfH;
  let srcW = targetW;
  let srcH = targetH;

  // Часть, которая реально есть на изображении
  const validSrcX = Math.max(0, srcX);
  const validSrcY = Math.max(0, srcY);
  const validSrcW = Math.min(this.img.naturalWidth - validSrcX, srcW - (validSrcX - srcX));
  const validSrcH = Math.min(this.img.naturalHeight - validSrcY, srcH - (validSrcY - srcY));

  // Масштаб, чтобы целевая область вписалась в canvas (с учётом отступов)
  const MARGIN = 20;
  const availW = W - 2 * MARGIN;
  const availH = H - 2 * MARGIN;
  const scale = Math.min(availW / srcW, availH / srcH);

  // Размеры отрисованной целевой области на canvas
  const dstW = srcW * scale;
  const dstH = srcH * scale;

  // Смещение целевой области внутри canvas (центрирование)
  const dstX = MARGIN + (availW - dstW) / 2;
  const dstY = MARGIN + (availH - dstH) / 2;

  // Рисуем только ту часть изображения, которая пересекается с целевой областью
  if (validSrcW > 0 && validSrcH > 0) {
    const imgDstX = dstX + (validSrcX - srcX) * scale;
    const imgDstY = dstY + (validSrcY - srcY) * scale;
    const imgDstW = validSrcW * scale;
    const imgDstH = validSrcH * scale;
    ctx.drawImage(
      this.img,
      validSrcX, validSrcY, validSrcW, validSrcH,
      imgDstX, imgDstY, imgDstW, imgDstH
    );
  }

  // Преобразование точек контура в координаты canvas
  const tpts = pts.map(p => [
    dstX + (p[0] - srcX) * scale,
    dstY + (p[1] - srcY) * scale
  ]);

  const col = LC[this.vals[this.idx]?.valLabel] || "#ff6b6b";
  this.drawShape(ctx, tpts, shape.shape_type, 1, col, hexA(col, 0.2), 2);
}

  drawShape(ctx, points, type, sc, stroke, fill, lw) {
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

  /* ===== Labels ===== */
  setLabel(val) {
    if (!this.jData) return;

    const shape = this.jData.shapes[this.idx];
    this.vals[this.idx] = {
      origLabel: shape.label || "",
      points: shape.points || [],
      shapeType: shape.shape_type || "polygon",
      valLabel: val,
    };
    this.allValsByFile[this.currentFileName] = { ...this.vals };
    this.updateUI();
    toast(`✓ ${val}`);

    if (this.idx < this.jData.shapes.length - 1) {
      setTimeout(() => {
        this.idx++;
        this.updateUI();
      }, 250);
    }
  }

  updateBtns(activeLabel) {
    document.querySelectorAll(".lbtn").forEach((b) => {
      b.classList.toggle("active", b.dataset.l === activeLabel);
    });
  }

  /* ===== Navigation ===== */
  navigate(d) {
    if (!this.jData) return;
    const ni = this.idx + d;
    if (ni < 0 || ni >= this.jData.shapes.length) return;
    this.idx = ni;
    this.updateUI();
  }

  lastLabeledIdx() {
    const keys = Object.keys(this.vals).map(Number);
    return keys.length ? Math.max(...keys) : null;
  }

  goToLast() {
    const li = this.lastLabeledIdx();
    if (li === null) return toast("No labeled cells yet");
    this.idx = li;
    this.updateUI();
    toast(`Navigating to cell #${li + 1}`);
  }

  jumpTo() {
    if (!this.jData) return;
    const v = parseInt($("jumpInput").value, 10);
    if (Number.isNaN(v) || v < 1 || v > this.jData.shapes.length) {
      toast(`Enter a number between 1 and ${this.jData.shapes.length}`);
      return;
    }
    this.idx = v - 1;
    $("jumpInput").value = "";
    this.updateUI();
  }

  /* ===== Modal ===== */
  openList() {
    if (!this.jData) return;
    $("listSearch").value = "";
    this.renderList();
    $("listModal").classList.add("open");
    $("listSearch").focus();
  }

  closeList() {
    $("listModal").classList.remove("open");
  }

  renderList() {
    if (!this.jData) return;
    const q = $("listSearch").value.trim().toLowerCase();
    const ul = $("modalList");
    ul.innerHTML = "";

    this.jData.shapes.forEach((shape, i) => {
      const v = this.vals[i];
      const vlabel = v?.valLabel || "";
      const numStr = String(i + 1);

      if (q) {
        const match = numStr.includes(q) ||
          vlabel.toLowerCase().includes(q) ||
          (shape.label || "").toLowerCase().includes(q);
        if (!match) return;
      }

      const div = document.createElement("div");
      div.className = "cell-item" + (i === this.idx ? " current" : "");
      div.addEventListener("click", () => {
        this.idx = i;
        this.updateUI();
        this.closeList();
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
  onGlobalKeydown(e) {
    if (e.key === "Escape") {
      this.closeList();
      return;
    }

    if (!this.jData) return;
    if (e.target.tagName === "INPUT") return;

    const map = {
      ArrowLeft: () => this.navigate(-1),
      ArrowRight: () => this.navigate(1),
      "1": () => this.setLabel("steatosis"),
      "2": () => this.setLabel("mesenchymal_cells"),
      "3": () => this.setLabel("normal"),
      "4": () => this.setLabel("non_nuclear"),
      "5": () => this.setLabel("balloon_dystrophy"),
    };

    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  }

  /* ===== Export XLSX ===== */
  exportXLSX() {
    if (!this.userName) return toast("Please enter validator name first");

    const all = this.collectAllProgressForUser();
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
          this.userName,
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
    XLSX.writeFile(wb, `validation_${this.userName}_${new Date().toISOString().slice(0, 10)}.xlsx`);

    toast(`✓ Exported ${totalRows} record(s) from ${fileNames.length} file(s)`);
  }

  /* ===== Export Corrected JSON ===== */
  exportCorrectedJSON() {
    if (!this.jData) return toast("No file loaded");

    const validatedCount = Object.keys(this.vals).length;
    if (!validatedCount) return toast("No labels assigned yet");

    const corrected = JSON.parse(JSON.stringify(this.jData));

    let correctedCount = 0;
    for (const [idxStr, val] of Object.entries(this.vals)) {
      const i = Number(idxStr);
      if (corrected.shapes[i] && val.valLabel) {
        corrected.shapes[i].label = val.valLabel;
        correctedCount++;
      }
    }

    const fileName = this.currentFileName.replace(/\.json$/i, "_corrected.json");
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
  lsKey() {
    return `cv_${this.userName}__${this.currentFileName || "no_file"}`;
  }

  save() {
    if (!this.userName) return;

    this.allValsByFile[this.currentFileName] = { ...this.vals };

    try {
      localStorage.setItem(this.lsKey(), JSON.stringify({ vals: this.vals, ts: Date.now() }));
    } catch (_) {}

    this.scheduleFileSave();
  }

  scheduleFileSave() {
    clearTimeout(this.fileAutosaveTimer);
    this.fileAutosaveTimer = setTimeout(() => {
      this.persistToFile().catch((e) => {
        console.warn("Auto-save to file failed:", e);
      });
    }, 200);
  }

  async pickSaveDir() {
    if (!window.showDirectoryPicker) {
      toast("Your browser doesn't support folder write access (use Chrome or Edge)");
      return;
    }

    try {
      this.saveDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      toast("Save folder selected");
      if (this.jData && this.currentFileName) {
        await this.loadProgressFromFile();
        this.updateUI();
        await this.persistToFile();
      }
    } catch {
      // User cancelled the picker
    }
  }

  async persistToFile() {
    if (!this.saveDirHandle || !this.userName || !this.currentFileName) return;

    const payload = {
      version: 1,
      userName: this.userName,
      sourceFile: this.currentFileName,
      savedAt: new Date().toISOString(),
      vals: this.vals
    };

    const fh = await this.saveDirHandle.getFileHandle(this.progressFileName(), { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  }

  async loadProgressFromFile() {
    if (!this.saveDirHandle || !this.currentFileName) return;

    try {
      const fh = await this.saveDirHandle.getFileHandle(this.progressFileName(), { create: false });
      const file = await fh.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (parsed && parsed.vals && typeof parsed.vals === "object") {
        this.vals = parsed.vals;
        this.allValsByFile[this.currentFileName] = { ...this.vals };
        toast(`Progress loaded from file: ${Object.keys(this.vals).length} label(s)`);
      }
    } catch {
      // File does not exist yet — that's fine
    }
  }

  progressFileName() {
    const base = safeName(this.currentFileName.replace(/\.json$/i, ""));
    const user = safeName(this.userName);
    return `${base}__${user}.validation.json`;
  }

  collectAllProgressForUser() {
    const result = {};

    for (const [fileName, fileVals] of Object.entries(this.allValsByFile)) {
      if (fileVals && Object.keys(fileVals).length) {
        result[fileName] = { ...fileVals };
      }
    }

    const prefix = `cv_${this.userName}__`;
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
}

/* ===== Global Utilities (unchanged) ===== */
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
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

function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ===== Start App ===== */
window.addEventListener("DOMContentLoaded", () => {
  const app = new ValidatorApp();
  app.init();
  // Expose for debugging (optional)
  window.app = app;
});