# LabelMe Validator

A lightweight browser-based tool for quality-control and correction of [LabelMe](https://github.com/wkentaro/labelme) annotation files. Designed for reviewing cell-level segmentation masks, assigning corrected class labels per shape, and exporting results in both spreadsheet and LabelMe-compatible JSON formats.

---

## Features

| Feature | Details |
|---|---|
| **Interactive cell viewer** | Zoomed-in canvas showing each annotated shape on the source image with a color-coded outline |
| **5 built-in cell classes** | Assign labels via button click or keyboard shortcut (keys 1–5) |
| **Multi-file workflow** | Load a folder of JSON files and switch between them without losing progress |
| **Progress tracking** | Per-file progress bar and labeled/total counter |
| **Cell list modal** | Browse, search, and jump to any cell by index, original label, or validator label |
| **Session persistence** | Validator name and all progress survive page refresh |
| **Auto-save** | Labels written to `localStorage` after every action; optionally mirrored to a `.validation.json` file |
| **Export — Excel** | Full validation report (all files, all labels) as a `.xlsx` spreadsheet |
| **Export — JSON** | Original LabelMe JSON with corrected `label` fields, ready for downstream use |

---

## Requirements

- **Browser:** Chrome or Edge (recommended). Firefox works for basic use but does not support the `💾 Save Folder` feature (File System Access API).
- **Input:** LabelMe JSON file(s) containing a `shapes` array. The `imageData` field (base64 image) is optional — if absent, only outlines are shown.

---

## Quick Start

1. Open `index.html` in your browser.
2. Enter your validator name and press **Start →**. Your session is automatically restored on next visit.
3. Load annotation data:
   - **📂 Load JSON** — drag & drop or click to open a single `.json` file.
   - **📁 Annotations Folder** — select a folder containing multiple JSON files.
   - If served via HTTP, JSON files placed in the `annotations/` subfolder are listed automatically.
4. Click a file from the list to open it.
5. Step through cells and assign labels using buttons or keyboard shortcuts.
6. Export your results when done.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1` | steatosis |
| `2` | mesenchymal_cells |
| `3` | normal |
| `4` | non_nuclear |
| `5` | balloon_dystrophy |
| `←` / `→` | Previous / Next cell |
| `Esc` | Close cell list modal |

---

## Input File Format

Standard LabelMe JSON:
```json
{
  "shapes": [
    {
      "label": "original_class",
      "points": [[x1, y1], [x2, y2], "..."],
      "shape_type": "polygon"
    }
  ],
  "imageData": "&lt;base64-encoded image&gt;",
  "imageWidth": 1024,
  "imageHeight": 768,
  "imagePath": "image.jpg"
}