# Pictus — Implementation Status

_Last updated: 2026-11-23_

This records where the implementation stands against [PLAN.md](PLAN.md): what is built, what has been verified, what hasn't, and what comes next.

## Summary

| | Status |
| --- | --- |
| Code for milestones M1–M7 | Written |
| Core unit tests | 38/38 pass (`pnpm test`) |
| Type-check (`pnpm check`) | 0 errors, 0 warnings |
| Frontend build (`pnpm build`) | Succeeds |
| Rust shell compile | **Blocked**: MSVC linker missing (see [Blocker](#blocker)) |
| App run in Tauri (`pnpm tauri dev`) | **Not yet run** |
| Installer (`pnpm tauri build`) | **Not yet run** |
| Git | Repo initialised, **nothing committed** |

## Blocker

Rust cannot link. Visual Studio Build Tools 2022 is installed, but without the **"Desktop development with C++"** workload (`Microsoft.VisualStudio.Workload.VCTools`); VS Community 2022 doesn't have it either. With no MSVC `link.exe`, the build picks up Cygwin's `C:\cygwin64\bin\link.exe` and fails with `link: extra operand ...`.

Fix (admin PowerShell, about 2 GB):

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive
```

Then open a new terminal and run `pnpm tauri dev`. Once MSVC is installed, rustc finds its `link.exe` directly, so Cygwin's copy on PATH won't get in the way.

## Milestone status

| Milestone | Status | Notes |
| --- | --- | --- |
| M1 Scaffold | Done | Tauri 2 + SvelteKit (SPA mode via adapter-static) + TS + Vite. Deps: `three`, `fflate`, `@tauri-apps/plugin-dialog`; dev: `vitest`, `@types/three`. |
| M2 Core model and viewport | Code done | 16³ chunked meshing, grid DDA raycast, render on demand. |
| M3 Editing tools | Code done | Place/erase/paint/pick/fill/box, X/Y/Z mirror, undo/redo, palette. |
| M4 Layer view | Code done | 2D layer editor beside the 3D view; layers above the current one are hidden in 3D. |
| M5 Files | Code done | `.pictus`, `.vox` import/export, PNG import, recent files, unsaved-changes prompt, "open with". |
| M6 Export and printability | Code done, core tested | STL/OBJ/3MF, multi-color, print check with fixes. |
| M7 Polish and installer | Code done | Dark UI, app icon, NSIS + MSI targets, `.pictus` file association. Installer not built yet. |

## Architecture

| Path | Contents |
| --- | --- |
| `src/lib/core/grid.ts` | `VoxelGrid`: `Uint8Array` of palette indices, 0 = empty, **Z-up**, max 128 per side. |
| `src/lib/core/palette.ts` | Palette as `0xRRGGBB` numbers; index 0 reserved; max 255 colors. |
| `src/lib/core/history.ts` | Undo/redo of cell diffs, capped by total cells (16M) and steps (300). |
| `src/lib/core/editor.ts` | `Editor`: owns the model; all mutations go through it; strokes group a drag into one undo step; emits `cells` / `palette` / `meta` / `reset` events. |
| `src/lib/core/tools.ts` | Mirror expansion, flood fill (3D, or 2D within a layer), box, Bresenham line. |
| `src/lib/core/raycast.ts` | Amanatides–Woo grid traversal; falls through to the floor; respects a layer limit. |
| `src/lib/core/topology.ts` | 2×2×2 lookup tables for non-manifold vertices, and `vertexSheets()` for splitting them. |
| `src/lib/core/mesher.ts` | `buildChunk` (viewport) and `buildBody` / `mergedBody` / `colorBodies` (export). |
| `src/lib/core/analysis.ts` | Loose parts (6-connected), thin contacts (edge/corner only), auto-fix. |
| `src/lib/core/io/` | `pictus.ts`, `vox.ts`, `image.ts` (quantize, outline plate, keyring loop). |
| `src/lib/core/export/` | `stl.ts` (binary), `obj.ts` (+MTL), `threemf.ts` (zip via fflate). |
| `src/lib/render/viewport.ts` | Three.js scene, OrbitControls, chunk meshes, ghosts, box preview, slice/mirror planes, highlight. |
| `src/lib/editing.ts` | Edit helpers shared by the 3D and 2D views. |
| `src/lib/actions.ts` | New/open/save/save as/import/export `.vox`, unsaved-changes prompt. |
| `src/lib/state/app.svelte.ts` | Svelte 5 rune state (`app`) and the single `editor`. |
| `src/lib/platform/files.ts` | Wrappers over the dialog plugin and the Rust file commands. |
| `src/lib/ui/` | MenuBar, Toolbar, SidePanel, StatusBar, ViewportView, SliceView, the dialogs, PrintCheckPanel. |
| `src/routes/+page.svelte` | Layout, keyboard shortcuts, window title, close prompt, startup file. |
| `src-tauri/src/lib.rs` | `read_file`, `write_file` (raw binary body, hex-encoded path header), `startup_file`. |
| `tests/` | `core`, `mesh`, `io` and `perf` specs, plus helpers (watertight check, volume). |

### Key design points

- **Watertight export mesh.** Coplanar faces are merged into rectangles, but each rectangle keeps a vertex at every unit step of its edge and is fanned from its center. This avoids T-junctions, which slicers report as open edges.
- **Edge- and corner-only contacts in the mesh.** Vertices are split per "sheet". At a 4-face edge, faces are paired by solid cell, unless the two solids are connected around both ends of the edge; then they are paired by empty cell. The rule depends only on the edge, so both endpoints agree. Every edge ends up shared by exactly 2 triangles.
- **Multi-color.** One closed body per color (faces between two colors appear in both bodies). In 3MF the bodies are components of one object, so slicers load them as parts of a single model.
- **Viewport.** Rendering happens only on change. Edits rebuild only the affected 16³ chunks (plus neighbours on chunk borders). Flat per-face shading is baked into vertex colors with `MeshBasicMaterial`, so no lights are needed.

### `.pictus` format (v1, little endian)

`"PCTS"`, then `u16 version`, `u16 sx, sy, sz`, `f32 voxelSize (mm)`, `u16 colorCount`, `colorCount × RGB`, `u32 length`, and finally `deflate(voxel bytes)` in x-fastest, then y, then z order.

## Changes from the plan

1. **No fs plugin.** Files are read and written through two Rust commands, so files opened by double-click or from the recent list aren't blocked by the plugin's path-scope rules.
2. **SvelteKit instead of a plain Svelte `App.svelte`.** The Tauri template uses SvelteKit in SPA mode. App code lives under `src/lib/`.
3. **Layer view hides the layers above** the current one instead of fading them. The 2D view shows the layer below faded, as an onion skin.
4. **Edge/corner contacts.** The export is made watertight by splitting vertices. The geometric fix (adding voxels) is a separate, user-triggered action in the print check.
5. **`.pictus` voxels are deflated directly**, with no separate RLE pass.

## Verification

### Done (automated)

- **Unit tests: 38/38 pass.** They cover:
  - grid indexing, bounds and resizing
  - undo/redo strokes, and dropping strokes that change nothing
  - mirroring, flood fill, box and line helpers
  - raycast: top and side hits, the floor, the layer limit, and misses
  - `.pictus` and `.vox` round-trips, and rejecting bad files
  - image import: orientation, plate, keyring, quantization, downscaling
  - the STL, OBJ and 3MF writers
  - viewport face culling
- **Watertight stress test.** 640 random shapes at several fill densities, plus a 3D checkerboard. Every merged and per-color body has every directed edge exactly once with its reverse, and the right volume.
- **Contact auto-fix.** Clears every contact in the test cases and in 10 random grids.
- **Timings on a dense 128³ stress model** (`tests/perf.test.ts`):

  | Step | Time | Note |
  | --- | --- | --- |
  | Full viewport rebuild (512 chunks) | ~208 ms | Only on load or palette change |
  | Merged export mesh | ~2.3 s | 1.14M triangles; deliberately extreme model |
  | Per-color export meshes | ~2.9 s | |
  | Print analysis | ~240 ms | |

### Not done yet

- Running the app: 3D view, tools, 2D layer editor, dialogs, saving, the close prompt, "open with".
- `pnpm tauri build`: install, double-click a `.pictus` file, uninstall.
- Opening exports in PrusaSlicer, Bambu Studio or Orca (repair warnings, parts per color, dimensions).
- `.vox` round-trip through MagicaVoxel itself.
- Frame rate on a laptop's integrated GPU with a full 128³ model.
- The Rust unit test (`cargo test`), blocked by the linker.

## Known limitations and follow-ups

- **Editing a palette color** rebuilds every chunk on each color-picker input event. Updates are batched per frame, but at 128³ each rebuild costs about 200 ms, so dragging the picker can stutter.
- **Export runs on the main thread.** The UI freezes for a few seconds on very large or noisy models. It could move to a Web Worker.
- **Space and Alt** are captured for orbiting (Space + drag), so Space can't press a focused button.
- **The 2D box tool** works only within the current layer and ignores the Height setting.
- **Palette colors can't be deleted**, only added and edited. Palette edits aren't undoable.
- **No single-instance handling.** Double-clicking a `.pictus` file while Pictus is open starts a second window.
- **CSP is `null`.** The app loads only local content, but a strict CSP could be added later.
- **STL** has no vertex identity, so slicers merge coincident vertices at edge/corner contacts. Use the print check fix, or export 3MF.

## Next steps

1. Install the MSVC C++ workload (see [Blocker](#blocker)).
2. Make a first git commit of the current state.
3. Run `pnpm tauri dev` and work through the manual checks in [PLAN.md](PLAN.md#tests-and-verification). Fix whatever turns up.
4. Run `pnpm tauri build` and test the installer and file association.
5. Check exports in a slicer.
6. Take on the follow-ups above as needed.
