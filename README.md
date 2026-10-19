# kev

A terminal AI assistant built with [OpenTUI](https://github.com/anomalyco/opentui)
and the [AI SDK](https://ai-sdk.dev). Chat with any OpenAI-compatible provider
from a TUI, run custom slash commands, and pick up where you left off — sessions
persist under `~/.kev/sessions`.

## Install

Prebuilt binaries for Linux, macOS, and Windows (x64 + arm64) ship with every
[GitHub release](https://github.com/dineshh-m/kev/releases). On Linux and
macOS, install with:

```bash
curl -fsSL https://github.com/dineshh-m/kev/releases/latest/download/install.sh | bash
```

The script detects your platform, verifies the download against `SHA256SUMS`,
and installs to `~/.local/bin` (override with `KEV_INSTALL_DIR`). Pin a version
with `curl -fsSL .../install.sh | bash -s -- 0.1.0`.

### Manual install

Download the archive for your platform, extract it, and put `kev` on your
`PATH`:

```bash
mkdir -p ~/.local/bin
tar -xzf kev-v0.1.0-linux-x64.tar.gz -C ~/.local/bin
kev --version
```

Available archives: `kev-<version>-linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64` (`.tar.gz`) and `kev-<version>-windows-x64.zip`, which is the
install path for Windows (Git Bash/MINGW). Each release includes a
`SHA256SUMS` file — verify with `sha256sum -c SHA256SUMS --ignore-missing`.

macOS builds are unsigned (ad-hoc signed by Bun). If Gatekeeper complains about
a downloaded binary, run `xattr -d com.apple.quarantine kev`.

The Groq default needs an API key; copy `.env.example` to `.env` in your working
directory and set it (Bun loads it automatically), or export the variable in
your shell.

## Run from source

Requires [Bun](https://bun.sh/) 1.3.0 or later.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

To typecheck:

```bash
bun run typecheck
```

To build a standalone binary for your current platform:

```bash
bun run build
```

## Provider configuration

Kev talks to any OpenAI-compatible chat endpoint (Groq, OpenAI, OpenRouter,
Together, Ollama, LM Studio, vLLM, …). The endpoint is configured in
`~/.kev/config.json`:

```json
{
  "providerName": "groq",
  "baseURL": "https://api.groq.com/openai/v1",
  "model": "qwen/qwen3.8-27b",
  "apiKeyEnv": "GROQ_API_KEY"
}
```

- All fields are optional. With no file, Kev uses the Groq defaults above — the
  same behavior as before provider configuration existed.
- `apiKeyEnv` names the environment variable holding the API key; the key itself
  is never stored in the file. An inline `apiKey` is accepted but discouraged,
  and no key at all is fine for local endpoints like Ollama.
- Precedence, lowest to highest: built-in default, `config.json`, then `KEV_*`
  env vars (`KEV_PROVIDER`, `KEV_BASE_URL`, `KEV_MODEL`, `KEV_API_KEY_ENV`,
  `KEV_API_KEY`). Editing the file requires a restart.

Examples:

```json
// OpenRouter
{ "providerName": "openrouter", "baseURL": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-sonnet-4.5", "apiKeyEnv": "OPENROUTER_API_KEY" }

// Ollama, local, no key
{ "providerName": "ollama", "baseURL": "http://localhost:11434/v1",
  "model": "llama3.3:70b" }
```

## Releasing (maintainers)

CI (`.github/workflows/ci.yml`) typechecks, tests, and smoke-builds on every
push and PR, and exercises `scripts/install.sh` end-to-end against a mock
release server (shellcheck + happy path + corrupted-archive rejection). A release is cut from a tag:

1. Bump `version` in `package.json` (single source of truth — the binary's
   `--version` reads it, and CI rejects a tag that disagrees with it).
2. Commit, then tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. `.github/workflows/release.yml` runs the tests, cross-compiles all five
   targets (`bun run build:release` — archives + `install.sh` + `SHA256SUMS`),
   smoke-tests the Linux binary, and publishes a GitHub release with the
   archives attached. `install.sh` ships as an asset too, so the
   `releases/latest/download/install.sh` one-liner always serves the copy
   belonging to the newest release.

`workflow_dispatch` runs the same build without publishing, for dry runs.

This project was created using `bun create tui`. [create-tui](https://github.com/msmps/create-tui) is the easiest way to get started with OpenTUI.
