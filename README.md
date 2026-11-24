# Pictus

A lightweight Windows app for making 3D pixel (voxel) models and exporting them for 3D printing.

- Place, erase, paint, pick, fill and box tools, X/Y/Z mirroring, and a 2D layer editor
- Import pixel art (PNG) as an extruded relief or keychain, and import or export MagicaVoxel `.vox`
- Export 3MF (one part per color), STL or OBJ, with watertight meshes
- Print check: finds loose parts and edge- or corner-only contacts, and fixes them

## Development

Working on Pictus with the team? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

Requirements: Node 22+, pnpm, Rust (MSVC toolchain), and the Visual Studio Build Tools **"Desktop development with C++"** workload.

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm test           # core unit tests
pnpm check          # type-check
pnpm tauri build    # Windows installers in src-tauri/target/release/bundle/
```

## Layout

| Path | What |
| --- | --- |
| `src/lib/core/` | Plain TypeScript with no DOM: grid, undo history, tools, raycast, meshers, print analysis, file formats, exporters |
| `src/lib/render/viewport.ts` | Three.js viewport: chunked meshes, camera and 3D tool input |
| `src/lib/ui/` | Svelte components |
| `src/lib/state/app.svelte.ts` | App state, plus the single `Editor` that owns the model |
| `src-tauri/` | Rust shell: binary file read/write and the "open with" path |
| `tests/` | Vitest specs for `core/` |

The `.pictus` format is a small binary header (dimensions, voxel size, palette) followed by the deflated voxel bytes. See `src/lib/core/io/pictus.ts`.
