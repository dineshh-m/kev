<h1 align="center">Kev</h1>

<p align="center">
   <img src="./docs/media/kev-logo.gif" width="300" alt="Demo"/>
</p>

Kev is an AI-powered terminal assistant (TUI) that lets you create reusable commands once and execute them anytime using the / command palette.

If you've used coding agents, you're probably familiar with **slash commands** or **reusable prompts** - prompts that you define once and invoke whenever you need them using `/<prompt-name>`.

Kev takes that idea a step further. Instead of just storing reusable prompts, Kev lets you **generate reusable commands with AI** and execute them anytime using the same `/` syntax.

What exactly is a command? It can be any repetitive task, workflow, or sequence of instructions that you don't want to remember or manually recreate every time. Just describe what you need, let AI generate the command once, and Kev persists it for you.

That's it! Your command is ready to be invoked whenever you need it with `/<command-name>`.


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

Kev talks to OpenAI, Anthropic and Groq through their native SDKs, and to
anything else through an OpenAI-compatible endpoint. `provider` picks the SDK:

| `provider` | SDK | default `baseURL` | default `apiKeyEnv` |
| --- | --- | --- | --- |
| `openai` | OpenAI Responses | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Messages | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` |
| `groq` | Groq chat completions | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `openai-compatible` | OpenAI-compatible | required | none (keyless allowed) |

The endpoint is configured in `~/.kev/config.json`:

```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-20b",
  "apiKeyEnv": "GROQ_API_KEY"
}
```

- `provider` is required whenever the file exists. With no file at all, Kev uses
  the Groq preset (provider `groq`, model `qwen/qwen3.8-27b`).
- Each provider seeds its own `baseURL` and `apiKeyEnv`; any field you write
  wins. `model` has no cross-provider default: it is required for `openai`,
  `anthropic` and `openai-compatible`, while `groq` falls back to its preset.
  `baseURL` is required for `openai-compatible`.
- `providerName` only matters for `openai-compatible`: it names the provider in
  SDK calls and defaults to `custom`.
- `apiKeyEnv` names the environment variable holding the API key; the key itself
  is never stored in the file. An inline `apiKey` is accepted but discouraged,
  and no key at all is fine for local endpoints like Ollama.
- Precedence, lowest to highest: provider defaults, `config.json`, then `KEV_*`
  env vars (`KEV_PROVIDER`, `KEV_PROVIDER_NAME`, `KEV_BASE_URL`, `KEV_MODEL`,
  `KEV_API_KEY_ENV`, `KEV_API_KEY`). `KEV_PROVIDER` takes a provider id. Editing the file requires a restart.

Examples:

```json
// OpenAI
{ "provider": "openai", "model": "gpt-5.1", "apiKeyEnv": "OPENAI_API_KEY" }

// Anthropic
{ "provider": "anthropic", "model": "claude-sonnet-4-5",
  "apiKeyEnv": "ANTHROPIC_API_KEY" }

// OpenRouter
{ "provider": "openai-compatible", "providerName": "openrouter",
  "baseURL": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-sonnet-4.5", "apiKeyEnv": "OPENROUTER_API_KEY" }

// Ollama, local, no key
{ "provider": "openai-compatible", "baseURL": "http://localhost:11434/v1",
  "model": "llama3.3:70b" }
```
