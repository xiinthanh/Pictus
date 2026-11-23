# Pictus — Implementation Plan

## Context
GOAL.md: a lightweight, user-friendly Windows desktop app for making 3D "pixel" (voxel) models to 3D print, with only the features that matter. The repo is empty (only GOAL.md). Decisions confirmed with the user:

- **Concept:** a voxel editor that can also import 2D pixel art (flat extrude into a keychain/plaque).
- **Stack:** Tauri 2 + Svelte 5 + TypeScript + Vite + Three.js. Almost all logic is in TS; Rust is only the thin shell (dialog/fs plugins).
- **Tools:** place / erase / paint / eyedropper, flood fill, box drag, X/Y/Z mirror, layer (slice) view, undo/redo.
- **Scale:** grid up to 128³, 1 mm voxels by default (voxel size can be changed at export).
- **Files:** own `.pictus` format, plus `.vox` (MagicaVoxel) import and export.
- **Export:** STL, OBJ+MTL, 3MF, with multi-color output (one body per color).
- **Printability:** greedy-meshed watertight output, a warning for floating parts, and detection plus auto-fix of edge/corner-only contacts.
- **Delivery:** a Windows NSIS installer and MSI with an app icon and a `.pictus` file association.

Environment: Node 22, pnpm 10 and git are present. **Rust and MSVC Build Tools are missing, and the user will install them** (step 0).

## Step 0 — Prerequisites (the user runs these)
- `winget install Rustlang.Rustup` → `rustup default stable-msvc`
- `winget install Microsoft.VisualStudio.2022.BuildTools`, with the "Desktop development with C++" workload
- WebView2 is preinstalled on Windows 11.
- Check: `cargo --version`, `rustc --version`

## Project layout
```
Pictus/
  package.json, vite.config.ts, tsconfig.json, svelte.config.js
  src/
    main.ts, App.svelte
    core/                 # pure TS, no DOM — unit-tested
      grid.ts             # VoxelGrid: Uint8Array(sx*sy*sz) palette indices, 0 = empty
      palette.ts          # 255 RGBA colors + default palette
      history.ts          # undo/redo of diff commands {idx[], before[], after[]}
      tools.ts            # place/erase/paint/pick/fill/box + mirror expansion
      raycast.ts          # grid DDA ray traversal (Amanatides–Woo) → hit voxel + face normal
      mesher.ts           # culled-face chunk mesher (viewport) + greedy mesher (export)
      analysis.ts         # floating components (6-connected BFS), edge/corner-contact detection + fix
      io/pictus.ts        # .pictus read/write
      io/vox.ts           # MagicaVoxel .vox read/write (SIZE/XYZI/RGBA chunks)
      io/image.ts         # PNG → palette quantize (≤255) → extruded grid
      export/stl.ts       # binary STL
      export/obj.ts       # OBJ + MTL (one group/material per color)
      export/threemf.ts   # 3MF zip (fflate): one object per color + basematerials
    render/
      viewport.ts         # Three.js scene, orbit camera, lights, grid floor, chunk meshes
      ghost.ts            # hover preview / box-drag preview / slice plane
    ui/
      Toolbar.svelte, Palette.svelte, SliceView.svelte (2D canvas of the current layer),
      ExportDialog.svelte, ImportImageDialog.svelte, NewModelDialog.svelte,
      PrintCheckPanel.svelte, StatusBar.svelte
    state/store.ts        # Svelte stores: grid, tool, color, mirror, layer, file path, dirty flag
    platform/files.ts     # wrapper over @tauri-apps/plugin-dialog + plugin-fs
  src-tauri/
    tauri.conf.json       # window, bundle targets (nsis, msi), fileAssociations .pictus, icons
    src/main.rs           # register plugins; forward the "open with" file path to the frontend
    capabilities/default.json
  tests/                  # Vitest specs for core/
```

## Milestones

### M1 — Scaffold
- `pnpm create tauri-app` (Svelte + TS template), then add `three` and `fflate`, plus `vitest` as a dev dependency.
- Add Tauri plugins `dialog` and `fs`, with capabilities limited to user-chosen paths.
- `git init` and a `.gitignore`.
- Done when `pnpm tauri dev` opens an empty window.

### M2 — Core model and viewport
- `VoxelGrid` with `get/set/inBounds/index` and a dimensions setting (default 32³, max 128³).
- Viewport: orbit/pan/zoom camera (Three `OrbitControls`), a ground grid, and a bounding box.
- **Chunk mesher**: 16³ chunks, rendering only faces toward empty neighbours, with vertex colors in one `MeshLambertMaterial`. Only dirty chunks are rebuilt after an edit, which keeps 128³ smooth on integrated GPUs.
- Raycast with grid DDA (not mesh raycasting), so it stays fast and exact. If nothing is hit, it hits the ground plane.

### M3 — Editing tools
- Left click applies the tool, right-drag orbits, middle-drag pans, the wheel zooms. Number keys switch tools; `Ctrl+Z` / `Ctrl+Y` undo and redo.
- Place (on the hit face's neighbour cell), erase, paint, and pick (eyedropper).
- Fill: 3D flood fill over the same color, 6-connected. In slice view it is 2D and limited to the layer.
- Box: drag from a start to an end cell, show a ghost preview, and place/erase/paint the whole box.
- Mirror: X/Y/Z toggles about the grid center. `tools.ts` expands each edited cell into its mirror images before committing.
- Every operation produces one `history` command, so undo/redo stays cheap.
- Palette panel: swatches, a color picker to edit them, and an "add color" button.

### M4 — Layer / slice view
- A `SliceView.svelte` panel with a 2D canvas showing layer Z = k, a layer slider, and PgUp/PgDn shortcuts.
- The same tools work in 2D. The 3D view shows a translucent slice plane and can fade the layers above it.

### M5 — Files
- `.pictus`: a header (magic, version, dims, palette, voxel size) plus RLE-compressed voxel bytes (fflate deflate). Supports New / Open / Save / Save As, a recent files list, an unsaved-changes prompt, and a `*` in the window title.
- `.vox`: import (the first model, clamped to 128³, palette mapped) and export.
- Image import: decode the PNG in a canvas (≤128 px per side), quantize to ≤255 colors (exact colors first, median cut as a fallback), treat transparent pixels as empty, and extrude each pixel N voxels. Options: an optional base plate (thickness and color) and an optional keyring hole.
- Handle "open with" and double-click from the file association: Rust reads `argv[1]` and emits it to the frontend.

### M6 — Export and printability
- **Greedy mesher**: per color, merge coplanar faces into rectangles, with integer vertices scaled by the voxel size in mm.
  - Single-color STL uses faces between solid and empty voxels.
  - Multi-color exports produce **one closed body per color**, including the faces between two colors, so each body is watertight.
- **STL**: either a single merged body, or one STL file per color, because STL has no color.
- **OBJ + MTL**: one `g`/`usemtl` per color.
- **3MF**: one `<object>` per color, all in one `<build>`, with `<basematerials>` colors. Bambu Studio, Orca and PrusaSlicer open these as multi-part models that can be assigned to filaments.
- Export dialog: format, voxel size in mm (shown as the resulting dimensions), and a "merge colors" option.
- **Print check panel**, run before export and on demand:
  - Floating parts: count of 6-connected components. Clicking one highlights it; it can then be deleted or kept.
  - Edge/corner-only contacts: find 2×2 and 2×2×2 diagonal configurations that are non-manifold. Clicking one highlights it. **Auto-fix** fills one empty cell of each configuration with a neighbour's color, and this is a single undoable command.
- Export is never blocked; problems only produce warnings.

### M7 — Polish and installer
- Minimal, uncluttered UI: a left toolbar, a right palette and settings panel, a bottom status bar showing the cell under the cursor, the voxel count and the dimensions. Tooltips show shortcuts. Dark theme.
- Settings remembered in `localStorage`: recent files and last export options.
- Icons generated with `pnpm tauri icon`. `tauri.conf.json`: product name "Pictus", identifier, bundle targets `nsis` and `msi`, and `fileAssociations` for `.pictus`.
- `pnpm tauri build` produces the `.exe` and `.msi` installers. The target is an installer around 10 MB, using under 200 MB RAM with a full 128³ model.

## Tests and verification
- **Vitest** (`pnpm test`) on `core/`:
  - grid indexing and bounds
  - undo/redo round-trips
  - mirror expansion
  - flood fill
  - DDA raycast hits
  - greedy mesh is **watertight** (every edge is shared by exactly 2 triangles, and the Euler characteristic is right for simple shapes)
  - each color body is watertight
  - edge-contact detection finds and fixes known cases
  - `.pictus` and `.vox` round-trip byte-identical voxels
  - STL triangle count matches; 3MF zip contains valid XML with N objects
- **Manual end-to-end** (`pnpm tauri dev`):
  1. Build a small colored figure with every tool, mirror and slice view, then undo/redo.
  2. Save, reopen, and check the model is identical.
  3. Import a 32×32 PNG with a base plate.
  4. Export STL, OBJ and 3MF, then open them in PrusaSlicer or Bambu/Orca Studio. Check there are no non-manifold or repair warnings, that 3MF parts show per color, and that dimensions match voxel size × grid.
  5. Round-trip `.vox` through MagicaVoxel.
  6. Load a full 128³ model and check orbiting stays smooth on a laptop iGPU.
- **Installer:** run `pnpm tauri build`, install it, double-click a `.pictus` file and check it opens in Pictus, then uninstall cleanly.
