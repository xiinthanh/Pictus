# Contributing to Pictus

Thanks for helping build Pictus. This guide covers setting up your machine, how we work together, and what a good pull request looks like. For what's in the codebase, see the [README](README.md); for current status, see [IMPLEMENTATION_DOC.md](IMPLEMENTATION_DOC.md).

## 1. Set up your machine (Windows)

Install:

1. **Node.js 22+**: <https://nodejs.org>
2. **pnpm**: `npm install -g pnpm`
3. **Rust**: `winget install Rustlang.Rustup`, then `rustup default stable-msvc`
4. **Visual Studio Build Tools 2022** with the **"Desktop development with C++"** workload:
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
   Without this workload, Rust fails to link with errors like `link: extra operand`.

Then:

```sh
git clone https://github.com/xiinthanh/Pictus.git
cd Pictus
pnpm install
pnpm tauri dev      # first run compiles Rust and takes a few minutes
```

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm tauri dev` | Run the app with hot reload |
| `pnpm test` | Unit tests for `src/lib/core/` |
| `pnpm check` | Type-check TypeScript and Svelte |
| `pnpm tauri build` | Build the Windows installers |

## 2. How we work

We use **GitHub Flow**: `main` is always releasable, and all changes arrive through pull requests.

1. **Start from an issue.** Pick one from the board, or open one first for anything non-trivial, so we agree on the approach before you write code. Assign it to yourself.
2. **Create a branch from up-to-date `main`:**
   ```sh
   git switch main && git pull
   git switch -c feat/palette-delete
   ```
   Prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.
3. **Commit as often as you like.** Branch commits are squashed on merge, so they don't need to be perfect.
4. **Open a pull request early.** A draft is fine. Fill in the template and link the issue (`Closes #12`).
5. **Give the PR a conventional-commit title.** It becomes the commit message on `main`:
   - `feat: delete unused palette colors`
   - `fix: box tool ignores height in layer view`
   - `docs: explain .pictus format`
6. **CI must pass and one teammate must approve.** Respond to every review comment, either with a change or with a reply.
7. **The author squash-merges** after approval. The branch is deleted automatically.

Keep pull requests **small and focused**: one feature or fix each, ideally under ~400 changed lines. Small PRs get reviewed faster and conflict less.

If `main` moves on while your PR is open, update your branch:

```sh
git fetch origin
git rebase origin/main      # or: git merge origin/main
git push --force-with-lease # only needed after a rebase
```

## 3. Code guidelines

- **`src/lib/core/` stays pure TypeScript** with no DOM, Svelte or Three.js. Every change there needs unit tests in `tests/`.
- **All model changes go through `Editor`** (`src/lib/core/editor.ts`) so undo/redo and re-rendering keep working. Never write to `grid.data` directly from the UI.
- **Export meshes must stay watertight.** If you touch `mesher.ts` or `topology.ts`, keep the stress test in `tests/mesh.test.ts` passing.
- **Keep Pictus lightweight and minimal.** Check with the lead before adding a dependency or a big feature.
- **TypeScript is strict.** `pnpm check` must show 0 errors and 0 warnings.

## 4. Reviewing

When you review a teammate's PR:

- Pull the branch and try the change in `pnpm tauri dev` when it affects the UI.
- Comment on behavior, correctness and clarity first, and style last.
- **Approve** when it's good to merge. Use **Request changes** only for things that must be fixed.

## 5. Releases (lead only)

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and merge that as a PR (`chore: release v0.2.0`).
2. Tag and push:
   ```sh
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. The **Release** workflow builds the installers into a **draft** GitHub Release. Check it, add notes, and publish.

## 6. Getting help

Ask in the issue or PR you're working on, so the discussion stays with the code. If you're stuck for more than an hour, ask. That's expected.
