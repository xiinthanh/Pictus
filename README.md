# Pictus

A lightweight Windows app for making 3D pixel (voxel) models and exporting them for 3D printing.

- Place, erase, paint, pick, fill and box tools, X/Y/Z mirroring, and a 2D layer editor
- Import pixel art (PNG) as an extruded relief or keychain, and import or export MagicaVoxel `.vox`
- Export 3MF (one part per color), STL or OBJ, with watertight meshes
- Print check: finds loose parts and edge- or corner-only contacts, and fixes them
- AI editing: let Claude Code build and fix the open model while you watch (see below)

## Development

Working on Pictus with the team? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

Requirements: Node 22+, pnpm, Rust (MSVC toolchain), and the Visual Studio Build Tools **"Desktop development with C++"** workload.

```sh
pnpm install
pnpm tauri dev      # run the app
pnpm test           # unit tests
pnpm check          # type-check
pnpm lint           # ESLint (pnpm format to apply Prettier)
cd src-tauri && cargo test   # Rust tests
pnpm tauri build    # Windows installers in src-tauri/target/release/bundle/
```

## AI editing with Claude Code

Pictus can act as a local [MCP](https://modelcontextprotocol.io) server, so Claude Code can edit the model that is open in the app. Every edit shows up live and can be undone with Ctrl+Z.

1. Click **Connect AI** in the menu bar. The first time, Pictus copies a one-time command to the clipboard.
2. Paste that command into a terminal and press Enter. It registers Pictus with Claude Code for every folder (`claude mcp add --scope user ...`).
3. Start (or restart) Claude Code and ask it to build something, for example "make a red and white mushroom 12 voxels tall, then check it for printing".

Pictus remembers the choice: if the connection was on when you closed it, it reconnects at the next launch. Click **AI on** to disconnect.

The AI gets ten tools: `get_model`, `get_layer`, `print_check`, `snapshot` (a picture of the 3D view), `set_voxels`, `fill_box`, `fix_thin_contacts`, `new_model`, `set_color` and `undo`.

Safety:

- The server listens on `127.0.0.1` only, needs the bearer token from the copied command, and rejects browser requests (any `Origin` header).
- The AI can't open, save or export files; you do that yourself.
- Each AI call is one undo step. Edits are refused while you are drawing or a dialog is open, and the AI's `undo` only reverts the AI's own edits.
- `new_model` is refused while the open model has unsaved changes. Palette changes (`set_color`) can't be undone.

Only Claude Code is supported. Other MCP clients that speak Streamable HTTP with a bearer header should work too, but haven't been tried.

## Layout

| Path | What |
| --- | --- |
| `src/lib/core/` | Plain TypeScript with no DOM: grid, undo history, tools, raycast, meshers, print analysis, file formats, exporters |
| `src/lib/render/viewport.ts` | Three.js viewport: chunked meshes, camera and 3D tool input |
| `src/lib/ui/` | Svelte components |
| `src/lib/state/app.svelte.ts` | App state, plus the single `Editor` that owns the model |
| `src/lib/mcp/` | MCP protocol and AI tools (plain TypeScript), plus `bridge.ts`, which connects them to the app |
| `src-tauri/` | Rust shell: binary file read/write, the "open with" path, and the local MCP relay (`mcp.rs`) |
| `tests/` | Vitest specs for `core/` and `mcp/` |

The `.pictus` format is a small binary header (dimensions, voxel size, palette) followed by the deflated voxel bytes. See `src/lib/core/io/pictus.ts`.
