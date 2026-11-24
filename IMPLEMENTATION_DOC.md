# Pictus — Implementation Status

_Last updated: 2026-11-24_

This records where the implementation stands against [PLAN.md](PLAN.md): what is built, what has been verified, what hasn't, and what comes next.

## Summary

| | Status |
| --- | --- |
| Code for milestones M1–M7 | Written |
| AI editing over MCP | Written on branch `feat/mcp` (see [AI editing (MCP)](#ai-editing-mcp)) |
| Unit tests (`pnpm test`) | 175/175 pass |
| Lint and format (`pnpm lint`, `pnpm format:check`) | Pass |
| Type-check (`pnpm check`) | 0 errors, 0 warnings |
| Frontend build (`pnpm build`) | Succeeds |
| Rust build and tests (`cargo build`, `cargo test`) | Succeed; 10/10 tests pass. Uses the MSVC toolchain from Visual Studio Community 2026 |
| App run in Tauri (`pnpm tauri dev`) | Runs; live UI tests pass after one fix (see [Live UI testing](#live-ui-testing)); exercised while building the MCP feature, no full manual pass yet |
| Installer (`pnpm tauri build`) | Built and installed before the MCP work; double-clicking a `.pictus` file opens it in Pictus. **Not yet rebuilt with the MCP code** |
| Slicer check of exports | **Not yet done** |
| Git | Committed: `master`, plus the `feat/mcp` branch |

## Milestone status

| Milestone | Status | Notes |
| --- | --- | --- |
| M1 Scaffold | Done | Tauri 2 + SvelteKit (SPA mode via adapter-static) + TS + Vite. Deps: `three`, `fflate`, `@tauri-apps/plugin-dialog`; dev: `vitest`, `@types/three`. |
| M2 Core model and viewport | Done, tested live | 16³ chunked meshing, grid DDA raycast, render on demand. |
| M3 Editing tools | Done, tested live | Place/erase/paint/pick/fill/box, X/Y/Z mirror, undo/redo, palette. Click/drag bugs fixed in `19f5338`. |
| M4 Layer view | Done, tested live | 2D layer editor beside the 3D view; layers above the current one are hidden in 3D. |
| M5 Files | Done, tested live | `.pictus`, `.vox` import/export, PNG import, recent files, unsaved-changes prompt, "open with" (double-click, tested with the installed build). |
| M6 Export and printability | Done, tested live | STL/OBJ/3MF, multi-color, print check with fixes. Not yet opened in a slicer. |
| M7 Polish and installer | Done | Dark UI, app icon, NSIS + MSI installers built and installed; the `.pictus` file association works. Uninstall not yet checked. |

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
| `src/lib/render/viewport.ts` | Three.js scene, OrbitControls, chunk meshes, ghosts, box preview, slice/mirror planes, highlight, animated view snaps (`viewFrom`). |
| `src/lib/editing.ts` | Edit helpers shared by the 3D and 2D views. |
| `src/lib/actions.ts` | New/open/save/save as/import/export `.vox`, unsaved-changes prompt. |
| `src/lib/state/app.svelte.ts` | Svelte 5 rune state (`app`) and the single `editor`. |
| `src/lib/platform/files.ts` | Wrappers over the dialog plugin and the Rust file commands. |
| `src/lib/ui/` | MenuBar, Toolbar, SidePanel, StatusBar, ViewportView, CubeView, SliceView, the dialogs, PrintCheckPanel. |
| `src/routes/+page.svelte` | Layout, keyboard shortcuts, window title, close prompt, startup file. |
| `src-tauri/src/lib.rs` | `read_file`, `write_file` (raw binary body, hex-encoded path header), `startup_file`. |
| `tests/` | `core`, `mesh`, `io` and `perf` specs, plus helpers (watertight check, volume). |

### Key design points

- **Watertight export mesh.** Coplanar faces are merged into rectangles, but each rectangle keeps a vertex at every unit step of its edge and is fanned from its center. This avoids T-junctions, which slicers report as open edges.
- **Edge- and corner-only contacts in the mesh.** Vertices are split per "sheet". At a 4-face edge, faces are paired by solid cell, unless the two solids are connected around both ends of the edge; then they are paired by empty cell. The rule depends only on the edge, so both endpoints agree. Every edge ends up shared by exactly 2 triangles.
- **Multi-color.** One closed body per color (faces between two colors appear in both bodies). In 3MF the bodies are components of one object, so slicers load them as parts of a single model.
- **Viewport.** Rendering happens only on change. Edits rebuild only the affected 16³ chunks (plus neighbours on chunk borders). Flat per-face shading is baked into vertex colors with `MeshBasicMaterial`, so no lights are needed.
- **View cube.** `CubeView.svelte` sits in the viewport's top-right corner and is drawn as SVG, not in WebGL. `Viewport.onCamera` passes it the camera rotation, and it projects the cube with a fixed orthographic projection, showing at most three faces. Each label is mapped onto its face with an SVG `matrix()` transform. Each face is split 3×3, giving 26 click targets (faces, edges, corners). A click calls `Viewport.viewFrom(dir)`, which swings the camera around the target over about 250 ms. Top and bottom views lean slightly toward −Y so the Z-up camera keeps a steady up direction. Clicking or scrolling the canvas, pressing F, or starting another snap cancels a running one. Because the cube is a separate DOM element, its clicks never reach the canvas's editing input. Face names follow the Z-up axes: Front = −Y, Right = +X, Top = +Z. The default framing (F) looks from front-right-top.

### `.pictus` format (v1, little endian)

`"PCTS"`, then `u16 version`, `u16 sx, sy, sz`, `f32 voxelSize (mm)`, `u16 colorCount`, `colorCount × RGB`, `u32 length`, and finally `deflate(voxel bytes)` in x-fastest, then y, then z order.

## Changes from the plan

1. **No fs plugin.** Files are read and written through two Rust commands, so files opened by double-click or from the recent list aren't blocked by the plugin's path-scope rules.
2. **SvelteKit instead of a plain Svelte `App.svelte`.** The Tauri template uses SvelteKit in SPA mode. App code lives under `src/lib/`.
3. **Layer view hides the layers above** the current one instead of fading them. The 2D view shows the layer below faded, as an onion skin.
4. **Edge/corner contacts.** The export is made watertight by splitting vertices. The geometric fix (adding voxels) is a separate, user-triggered action in the print check.
5. **`.pictus` voxels are deflated directly**, with no separate RLE pass.

## AI editing (MCP)

Pictus runs a local MCP server (Streamable HTTP) so Claude Code can edit the open model. It is off by default and turned on with the menu's **Connect AI** button. See the README for the user steps.

```
Claude Code --POST /mcp--> Rust relay (tiny_http, 127.0.0.1:47821)
                             checks path, method, Origin, token, size
                             emits "mcp-request" {id, body, MCP headers}
                                   v
                           TS: bridge.ts -> protocol.ts -> tools -> Editor
                             invoke("mcp_respond", {id, status, body})
Claude Code <---answer---- Rust relay
```

**Rust is a dumb relay.** All protocol and tool logic is TypeScript, so it reuses `Editor` and `core/` and is covered by vitest.

| Path | Contents |
| --- | --- |
| `src-tauri/src/mcp.rs` | `mcp_start` / `mcp_stop` / `mcp_respond`. 127.0.0.1 only; 401 without the bearer token (constant-time compare), 403 for any `Origin`, 404/405/413 (4 MB) for bad requests, 504 if the window doesn't answer within 60 s. One request at a time. |
| `src/lib/mcp/protocol.ts` | JSON-RPC and MCP, dual-era: 2026-07-28 (`_meta` version, `server/discover`, header checks, `ttlMs`/`cacheScope` on discover and `tools/list`) and the older `initialize` handshake (2025-03-26 to 2025-11-25). Tool failures come back as `isError: true` results. |
| `src/lib/mcp/tools.ts` | `ToolCtx` (everything a tool may touch), `get_model`, `get_layer`, and the tool list. |
| `src/lib/mcp/editTools.ts` | `set_voxels` (up to 20,000 cells), `fill_box`, `fix_thin_contacts`, `new_model`, `set_color`, `undo`. |
| `src/lib/mcp/inspectTools.ts` | `print_check` (lists up to 50 problems, highlights up to 20,000 cells), `snapshot` (PNG, longest side 768 px). |
| `src/lib/mcp/args.ts` | Argument checks with error messages that name the argument, the allowed range and the value received. |
| `src/lib/mcp/settings.ts` | Saved setting `{isEnabled, token}` (`localStorage` key `pictus.mcp`), 32-byte hex token, the `claude mcp add` command. |
| `src/lib/mcp/bridge.ts` | Event listener, start/stop (serialized), Connect AI button, reconnect at launch, and the live `ToolCtx`. |

Rules the tools follow:

- **One call is one undo step** (`beginStroke` / `endStroke`), and every argument is checked before anything changes.
- **Refused while busy:** while the user is mid-stroke, or a dialog, confirm box, file picker or save is open (`app.busyTasks`).
- **The AI's `undo` only reverts AI steps.** They are tracked by identity against `History.lastUndo`; a user's step on top is never undone.
- **After an AI edit changes cells,** the print-check highlight is cleared, so a later snapshot doesn't show fixed problems.
- **Snapshots** render the view and downscale it to a 2D canvas. `overview` uses a cloned 3/4 camera and hides the cursors and slice plane; the user's camera never moves. In layer view the reply adds a note that the upper layers are hidden.
- **No file tools.** The AI can't open, save or export.
- **Dev shortcut:** `VITE_PICTUS_MCP_TOKEN=<token> pnpm tauri dev` connects at launch with that token. It is ignored in release builds.

Checked in the running app with Claude Code:

- curl: 200 / 202 / 401 / 403 / 404 / 405 / 413 / 400, and parallel requests.
- Claude Code: reading the model, drawing a mushroom, undo, snapshot, print check and fixing.
- Ctrl+Z removes AI steps. AI edits are refused while a confirm box or Save As is open.
- Snapshot works with the window minimized, and is correct in layer view.

## Verification

### Done (automated)

- **Unit tests: 175/175 pass.** Besides the MCP specs (protocol, every tool, argument errors, settings), they cover:
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

### Live UI testing

The running dev app (`pnpm tauri dev`) was driven with real mouse and keyboard input through Playwright, connected to WebView2's DevTools port:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'; pnpm tauri dev
```

Clicks were aimed at known cells by reading the hovered cell from the status bar. Native file dialogs were answered at the IPC layer: Playwright intercepted the `ipc.localhost/plugin:dialog|open` and `|save` requests and answered with test paths. Everything after the dialog ran for real: encoding, the Rust file writes, decoding. The test scripts were throwaway and are not in the repo.

**Bugs found and fixed** in `src/lib/render/viewport.ts` (commit `19f5338`):

1. **Place added two voxels per click.** `onDown` re-ran `onMove`, whose plane through cell *centers* landed on a different cell than the clicked face.
2. **Erase removed two voxels per click** and dug deeper while dragging, because the follow-up raycast hit the voxel behind.
3. **The box rectangle was shifted and too small,** for the same plane reason.

Drags now intersect the plane of the clicked face, erase and paint drags stay on the starting layer, and `onDown` no longer re-applies the tool.

**Passing after the fix (no console errors):**

| Area | Checks |
| --- | --- |
| 3D tools | Place, stack on a voxel, drag-place a row, undo/redo of a drag as one step, erase, mirror X places a pair, paint then pick reads the color back, box (height 1 and 3), fill recolors a connected slab |
| 2D layer editor | Click places, drag draws a continuous line, right-click erases, PgUp changes layer |
| Print check | Lists loose parts; "Keep only the main body" leaves one part |
| Image import | 12×10 PNG with outline plate and keyring → 14×16×3, 3 colors, 267 voxels; title updates |
| Save / New / Open | `.pictus` written; reopened model identical; no prompt right after saving; recent list updated |
| Unsaved changes | Prompt on New; prompt on window close (real `WM_CLOSE`, like the title-bar X); Cancel keeps the app open |
| Export | 3MF with 3 color parts; single STL; 3 per-color STLs; OBJ+MTL; status bar message |
| `.vox` | Export, then re-import, inside the app gives an identical model |
| Rust IPC | `write_file`/`read_file` round-trip of 70 KB of binary data to a path with a non-ASCII character |

**View cube (added later, browser only).** Tested on the Vite dev server in headless Chrome through Playwright. `window.__TAURI_INTERNALS__` was stubbed, because outside Tauri `getCurrentWindow()` throws inside an `$effect` and stops Svelte's other effects from running. These checks pass with no console errors:

- The default framing shows Front, Right and Top.
- The cube turns with a right-drag orbit, and its labels are not mirrored.
- Top gives a straight-down view.
- The Front-Right-Top corner gives an isometric view.
- F returns the camera to the default view.

### Installer

`pnpm tauri build` (2026-11-24, includes the viewport fix) produced:

| File | Size |
| --- | --- |
| `src-tauri/target/release/bundle/nsis/Pictus_0.1.0_x64-setup.exe` | 1.5 MB |
| `src-tauri/target/release/bundle/msi/Pictus_0.1.0_x64_en-US.msi` | 2.2 MB |
| `src-tauri/target/release/pictus.exe` (the app itself) | 4.4 MB |

Both installers are well under the ~10 MB target. The installer was run on the development laptop and installed correctly. **Double-clicking a `.pictus` file opens it in the installed Pictus**, so the file association and the startup-file command work. The installers aren't code-signed, so Windows SmartScreen warns on first run (More info → Run anyway).

### Not done yet

- A full manual pass over the app: 3D view, tools, 2D layer editor, dialogs, saving, the close prompt, "open with".
- The **Connect AI** button in an installed build: first-time registration and reconnecting at launch.
- `pnpm tauri build` with the MCP code: install and double-click a `.pictus` file again.
- The native file dialogs themselves (intercepted in the tests above).
- The view cube inside the Tauri app (`pnpm tauri dev`); so far it has only been tested in a browser.
- Uninstalling through Settings → Apps.
- Opening exports in PrusaSlicer, Bambu Studio or Orca (repair warnings, parts per color, dimensions).
- `.vox` round-trip through MagicaVoxel itself.
- Frame rate on a laptop's integrated GPU with a full 128³ model.

## Known limitations and follow-ups

- **Editing a palette color** rebuilds every chunk on each color-picker input event. Updates are batched per frame, but at 128³ each rebuild costs about 200 ms, so dragging the picker can stutter.
- **Export runs on the main thread.** The UI freezes for a few seconds on very large or noisy models. It could move to a Web Worker.
- **Space and Alt** are captured for orbiting (Space + drag), so Space can't press a focused button.
- **The 2D box tool** works only within the current layer and ignores the Height setting.
- **Palette colors can't be deleted**, only added and edited. Palette edits aren't undoable.
- **No single-instance handling.** Double-clicking a `.pictus` file while Pictus is open starts a second window.
- **CSP is `null`.** The app loads only local content, but a strict CSP could be added later.
- **STL** has no vertex identity, so slicers merge coincident vertices at edge/corner contacts. Use the print check fix, or export 3MF.
- **The default image-import plate color (#212121)** is barely visible against the dark viewport background, which makes the keyring loop hard to see. A lighter default would help.
- **Clicking a face whose neighbouring cell is outside the grid** (e.g. the front face of a voxel on the grid edge) does nothing, and no hover ghost appears. That's correct, but there's no feedback telling you why.
- **Toolbar settings** (box height, mirror, tool) carry over when you create or open a model. That's intended, but easy to miss.

## Next steps

1. Work through the manual checks in [PLAN.md](PLAN.md#tests-and-verification) with `pnpm tauri dev`. Fix whatever turns up.
2. Run `pnpm tauri build` and test the installer, the file association and the Connect AI button.
3. Try the real Open and Export dialogs once in the installed app.
4. Check memory (target under 200 MB) and frame rate with a full 128³ model on the laptop.
5. Check exports in a slicer (PrusaSlicer / Bambu Studio / Orca).
6. Check that uninstalling removes Pictus cleanly.
7. Consider adding the live UI test as a repeatable script (Playwright over the WebView2 debug port).
8. Take on the follow-ups above as needed.
