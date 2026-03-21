# Contributing to Faber

Thank you for your interest in contributing to Faber! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Code Style & Conventions](#code-style--conventions)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone. Harassment, trolling, and disrespectful behavior will not be tolerated.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/faber.git
   cd faber
   ```
3. **Add the upstream remote:**
   ```bash
   git remote add upstream https://github.com/orecus/faber.git
   ```

## Development Environment

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Rust](https://rustup.rs/) | stable 1.77+ | `rustup` |
| [Node.js](https://nodejs.org/) | v22+ | Download or use `nvm` |
| [pnpm](https://pnpm.io/) | v9+ | `npm i -g pnpm` |
| [Git](https://git-scm.com/) | latest | Platform package manager |

### Platform-specific dependencies

<details>
<summary><strong>Linux (Debian/Ubuntu)</strong></summary>

```bash
sudo apt-get update
sudo apt-get install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```
</details>

<details>
<summary><strong>Linux (Fedora/RHEL)</strong></summary>

```bash
sudo dnf install \
  gtk3-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  patchelf
```
</details>

<details>
<summary><strong>Linux (Arch)</strong></summary>

```bash
sudo pacman -S gtk3 webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf
```
</details>

<details>
<summary><strong>macOS</strong></summary>

```bash
xcode-select --install
```
</details>

<details>
<summary><strong>Windows</strong></summary>

- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10 1803+ and Windows 11)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload
</details>

### Running the app

```bash
# Install frontend dependencies
pnpm install

# Start the full app (Vite frontend + Tauri/Rust backend with hot-reload)
pnpm tauri dev
```

### Useful commands

```bash
pnpm dev                # Vite dev server only (frontend HMR, no Tauri backend)
pnpm build              # Type-check + Vite production build
pnpm preview            # Preview production build locally
pnpm prepare-sidecar    # Rebuild the faber-mcp sidecar binary (debug)

# Rust (from src-tauri/)
cargo build             # Build Rust backend
cargo test              # Run Rust unit tests
cargo clippy            # Lint Rust code
```

> **Note:** `pnpm tauri dev` automatically builds the MCP sidecar binary before starting (via `beforeDevCommand` in `tauri.conf.json`). If you need to rebuild the sidecar manually, use `pnpm prepare-sidecar`.

### Building for production

```bash
# Build the full desktop app (produces platform-specific installers)
pnpm tauri build
```

Build outputs:

| Platform | Formats | Path |
|----------|---------|------|
| Linux | `.deb`, `.rpm`, `.AppImage` | `src-tauri/target/release/bundle/` |
| macOS | `.dmg`, `.app` | `src-tauri/target/release/bundle/` |
| Windows (installer) | `.exe` (NSIS) | `src-tauri/target/release/bundle/nsis/` |
| Windows (portable) | `faber.exe` | `src-tauri/target/release/` |

## Code Style & Conventions

### TypeScript (Frontend)

- **Strict mode** is enabled (`noUnusedLocals`, `noUnusedParameters`) — no unused variables or imports.
- **Functional components** with hooks. Use `useCallback` for event handlers.
- **Zustand** for state management. Always use selectors: `useAppStore((s) => s.field)` — never subscribe to the whole store.
- Keep frontend types in `src/types.ts` in sync with Rust models in `src-tauri/src/db/models.rs`.

### Tailwind CSS (Styling)

- **All styling must use Tailwind CSS classes.** Do not use inline `style={{}}` for new code.
- Use **ShadCN CSS variables** as the source of truth: `bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, etc.
- Custom semantic tokens: `text-dim-foreground`, `text-success`, `text-warning`.
- Use `ring-1 ring-border/40` for subtle panel borders, `border-border` for structural dividers.
- Use `<Loader2>` from lucide-react with `animate-spin` for loading spinners.

### Rust (Backend)

- All Tauri commands return `Result<T, AppError>` using the custom `AppError` enum with `From` conversions.
- Thread-safe state with `Mutex` (sync) or `Arc<TokioMutex>` (async).
- Run `cargo clippy` before submitting — warnings should be resolved.
- Run `cargo test` to verify all unit tests pass.

### General

- Commit messages should be concise and descriptive. We loosely follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Keep PRs focused — one feature or fix per PR.

## Making Changes

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
   Use prefixes like `feat/`, `fix/`, `docs/`, `refactor/` for clarity.

2. **Make your changes** and test locally:
   ```bash
   # Frontend type-check
   pnpm build

   # Rust lint + test
   cd src-tauri
   cargo clippy
   cargo test
   ```

3. **Commit** your work with a clear message:
   ```bash
   git commit -m "feat: add dark mode toggle to settings"
   ```

4. **Keep your branch up to date** with upstream:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

## Pull Request Process

1. **Push** your branch to your fork:
   ```bash
   git push origin feat/my-feature
   ```

2. **Open a Pull Request** against `orecus/faber:main` on GitHub.

3. **Fill out the PR template** with:
   - A clear description of what changed and why
   - Steps to test the changes
   - Screenshots or recordings for UI changes

4. **Ensure CI passes:**
   - `cargo clippy` (no warnings)
   - `cargo test` (all tests pass)
   - `pnpm build` (TypeScript compiles without errors)

5. **Respond to review feedback.** We may request changes — this is a normal part of the process.

6. Once approved, a maintainer will merge your PR.

### PR tips

- Keep diffs small and focused. Large PRs are harder to review.
- If your change is significant, consider opening an issue first to discuss the approach.
- Link related issues in your PR description (e.g., "Closes #42").

## Reporting Issues

### Bug reports

When filing a bug report, please include:

- **Faber version** (shown in the app title bar or Settings)
- **Operating system** and version (e.g., Windows 11, macOS 15.3, Ubuntu 24.04)
- **Steps to reproduce** the issue
- **Expected behavior** vs. **actual behavior**
- **Screenshots or terminal output** if applicable
- **Agent being used** (Claude Code, Gemini CLI, etc.) if relevant

### Feature requests

We welcome feature suggestions! When proposing a feature:

- **Describe the problem** you're trying to solve
- **Describe the solution** you'd like to see
- **Consider alternatives** you've thought about
- Check existing [issues](https://github.com/orecus/faber/issues) to avoid duplicates

### Security vulnerabilities

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-managing-vulnerabilities/privately-reporting-a-security-vulnerability).

## Releases

### Version numbers

The app version is defined in **three files** that must be kept in sync:

| File | Field | Example |
|------|-------|---------|
| `package.json` | `"version"` | `"0.6.0"` |
| `src-tauri/Cargo.toml` | `version` under `[package]` | `"0.6.0"` |
| `src-tauri/tauri.conf.json` | `"version"` | `"0.6.0"` |

We follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** (`0.5.0` → `0.5.1`) — Bug fixes, minor tweaks
- **MINOR** (`0.5.1` → `0.6.0`) — New features, backward-compatible changes
- **MAJOR** (`0.6.0` → `1.0.0`) — Breaking changes, major milestones

### Creating a release

1. **Update the version** in all three files listed above.

2. **Commit the version bump:**

   ```bash
   git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
   git commit -m "chore: bump version to 0.7.0"
   ```

3. **Create and push a tag** (must start with `v`):

   ```bash
   git tag v0.7.0
   git push origin main --tags
   ```

4. **The release workflow runs automatically.** It builds for all platforms, signs the binaries, and creates a **draft** GitHub Release with installer artifacts.

5. **Publish the release** — Go to [GitHub Releases](../../releases), review the draft, edit the release notes if needed, and click **Publish**.

> **Note:** The release is created as a draft so you can review release notes before making it public. The auto-updater endpoint (`latest.json`) only picks up published (non-draft) releases.

You can also trigger the release workflow manually from the GitHub Actions UI via `workflow_dispatch` (the tag must already exist).

### CI/CD

GitHub Actions workflows are in `.github/workflows/`:

- **`ci.yml`** — Runs on push to `main` and pull requests. Rust tests + clippy on all platforms, then builds and uploads artifacts.
- **`release.yml`** — Triggered on tag push (`v*`). Builds all platforms and creates a draft GitHub Release with installer artifacts.

---

Thank you for contributing to Faber!
