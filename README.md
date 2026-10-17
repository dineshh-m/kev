# react

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

Copy `.env.example` to `.env` and set the key for your provider; Bun loads it
automatically.

This project was created using `bun create tui`. [create-tui](https://github.com/msmps/create-tui) is the easiest way to get started with OpenTUI.
