# Agent Instructions

## Runtime

Bun >= 1.3.0 required. Do not use Node or npm. Bun auto-loads `.env`; copy `.env.example` to `.env` and set `GROQ_API_KEY` or AI replies fail.

## Commands

- `bun dev` — run in watch mode (`bun run --watch src/index.tsx`)
- `bun run typecheck` — type-check only (`tsc --noEmit`)
- `bun test` — unit tests for the non-React modules (`commands.ts`, `exec.ts`). The TUI itself has no headless test path.

## Skill

The canonical OpenTUI reference is vendored at `.agents/skills/opentui` (see `skills-lock.json`). Load the `opentui` skill before adding or changing UI components/APIs.

## Framework

OpenTUI — a terminal UI framework built on React. JSX transform source is `@opentui/react` (not `react-dom`).

Components use OpenTUI primitives: `<box>`, `<text>`, `<markdown>`, `<input>`, `<scrollbox>`, etc. Do not use HTML/DOM elements.

## TypeScript

- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- Strict mode is on.

## Source layout

- `src/index.tsx` — entrypoint; wires `createCliRenderer` + `createRoot` from `@opentui/core`/`@opentui/react`.
- `src/App.tsx` — chat UI state: message list, input draft, the `/` command palette wiring, and command execution.
- `src/ai.ts` — streams assistant replies via the AI SDK (`streamText` with an OpenAI-compatible provider). No DOM or React here.
- `src/config.ts` — resolves the provider config (`~/.kev/config.json`, `KEV_*` overrides) into a `ProviderConfig`; `getModelLabel` for the status line. No React here.
- `src/commands.ts` — loads `~/.kev/commands/*.md` (YAML frontmatter + raw script body), validates, filters, and creates/updates command files. No React here.
- `src/exec.ts` — runs a command locally with `Bun.spawn` (stdin ignored, stdout/stderr piped) and streams output back as events. Never invoked by the model.
- `src/transcript.ts` — the UI transcript as `TranscriptEntry[]`: chat messages and UI-only run entries, plus `chatMessages()` which is what the model gets. No React here.
- `src/sessions.ts` — persists transcripts as JSON under `~/.kev/sessions/<id>.json`, and repairs cut-short entries on load. No React here.
- `src/tools.ts` — the tools handed to the model via `streamText`: `readFile` / `listFiles` for project inspection, plus `listCommands` / `readCommand` / `createCommand` / `updateCommand` for authoring commands.
- `src/theme.ts` — exports `syntaxStyle` (`SyntaxStyle.fromStyles`), consumed by the `<markdown>` component.
- `src/debug.ts` — the file logger (`log` / `logError`) writing to `~/.kev/kev.log`. No React here.
- `src/components/` — presentational components: `AiMessage`, `UserMessage`, `CommandRun`, `CommandPalette`, `CommandDetail`, `ParamForm`, `SessionPicker`, `Spinner`, `AsciiBanner`, `HomeHero` (the empty-transcript welcome: framed banner panel, rotating tips, key legend, status line).

## Command execution

Selecting a palette entry runs the command on the client. Nothing about the run is sent to the model.

- A run is a `{ kind: "run" }` transcript entry (`src/transcript.ts`), not a `UIMessage`. It carries no text or data parts, so it cannot be serialized into model context; `chatMessages()` filters runs out before `streamAssistantResponse` sees anything. The model is not even told that a command ran.
- Only one thing runs at a time — `status` in `App.tsx` is `"idle" | "streaming" | "running"`.
- Esc cancels a running command via an `AbortController`. Ctrl+C is *not* wired up for this: OpenTUI installs its own SIGINT handler that calls `renderer.destroy()`.
- `dangerous: true` in the frontmatter forces a y/n confirm in the palette footer. Esc or any other key cancels.
- Commands may declare `params` in frontmatter (name, optional description/default/required). Selecting such a command opens a `ParamForm` overlay first; the required fields must be non-empty before submit, then the dangerous confirm (if any) runs, then execution. Values are resolved from input (falling back to defaults) and injected as `KEV_PARAM_<UPPER_NAME>` environment variables in `src/exec.ts` — never interpolated into the script text.
- Output is capped in the accumulator (`OUTPUT_CHAR_BUDGET`, `OUTPUT_MAX_LINES`), not via `maxBufferBytes`, which would kill the process.
- Cancellation is detected from a non-null exit signal, not `Subprocess.killed` — that field is true after ordinary exits too.

## Command authoring

The model can create and edit command files, but it can never run one. The split is strict: `src/tools.ts` writes, `src/exec.ts` runs, and nothing connects them.

- Authoring goes through `listCommands` / `readCommand` / `createCommand` / `updateCommand`, all backed by `src/commands.ts`. No tool takes a filesystem path — a command is addressed by name only, so the model cannot write outside `~/.kev/commands`. Do not add one.
- Every write is `serializeCommand` → `parseCommandFile` → `writeFile` (`writeValidated` in `src/commands.ts`). The parse step *is* the validation gate, and it is the same validator the palette uses, so a bad name, unknown type, empty script or malformed `params` entry throws before anything reaches disk. Keep writes going through it rather than re-checking fields by hand.
- `createCommandFile` refuses an existing name and points at `updateCommand`; there is no overwrite and no delete. `updateCommandFile` merges, so an omitted field — `dangerous` and `params` included — keeps its current value and a patch can clear the flag or params (`params: []`) as easily as set it.
- Param values never reach the model or the script text; they are handed to `exec.ts` as a plain `Record<string, string>` and exported as env vars by `buildParamEnv`/`paramEnvName` in `src/commands.ts`.
- Writes apply immediately; there is no approval step. The y/n gate covers *execution* only.
- The model supplies the `dangerous` flag and the system prompt asks it to, but nothing enforces that. A script deleting data without the flag will run unconfirmed.
- The palette re-reads the directory on open (`refreshCommands` in `App.tsx`), so a freshly written command shows up on the next `/` with no extra wiring.
- With the palette open, `ctrl+k` opens a read-only detail overlay (`CommandDetail`, backed by `viewDetail`/`detailScroll` in `App.tsx`) for the highlighted entry: name, description, type, dangerous flag, params and script body. `↑/↓` scrolls a script that does not fit; `esc` or `ctrl+k` returns to the palette (the draft is untouched, so the palette is still there). It works for builtins too — they show a note instead of type/params/script. Nothing runs from this overlay.

## Persistence

Sessions are saved to `~/.kev/sessions/<id>.json` so a restart does not lose work. Kev still starts on an empty transcript; a saved session is only loaded explicitly via `resume-session`.

- A `StoredSession` is `{ version, id, cwd, createdAt, updatedAt, entries }` — the whole `TranscriptEntry[]`, runs included, written as-is since both `UIMessage` and `RunData` are plain JSON. `cwd` is recorded only so the picker can show which project a session came from.
- Saving is a `useEffect` on `entries` in `App.tsx`, debounced (`SAVE_DEBOUNCE_MS`) and skipped while the transcript is empty, so starting Kev never litters the directory. Writes are chained through `saveChainRef` so two flushes cannot land out of order, and `saveSession` writes a `.tmp` then renames, so a crash mid-write cannot tear the file.
- `loadSession` runs `sanitizeEntries`, the crash-repair pass: a run left `"running"` becomes `"cancelled"`, a text part left `"streaming"` becomes `"done"`, and a tool part still at `input-streaming`/`input-available` is dropped — a dangling tool call would otherwise render as a perpetual spinner and reach `convertToModelMessages` with no result. Terminal tool parts (`output-available`, `output-error`, `output-denied`) are kept.
- `listSessions` returns summaries (id, cwd, updatedAt, entry count, first-user-text preview) newest-first, skipping corrupt files and sessions with no entries. `resume-session` is the only reader; there is no auto-resume and no delete yet.

## Logging

Errors are written to `~/.kev/kev.log` via `src/debug.ts` (`log(message)` and `logError(context, error)`). The TUI owns the terminal, so anything printed to stderr is invisible or corrupts the render — the log file is the durable trail.

- `logError` serializes `Error` to its stack; anything else via `String()`. It is fire-and-forget but safe: writes are chained so they cannot interleave, `log`/`logError` never throw, and a rejected write is swallowed rather than becoming an unhandled rejection.
- The file rotates to `kev.log.old` once it passes ~1 MB. The directory is created lazily.
- `src/index.tsx` installs `uncaughtException` (log then exit) and `unhandledRejection` (log and continue) handlers, and logs a failed `createCliRenderer`.
- Every previously silent `catch {}` — session save/list/load, command load/parse, exec spawn/pipe/exit, the AI stream, and each tool `execute` — now routes through `logError`. Keep new error paths doing the same; a `catch {}` with no log is the bug this replaced.

## Provider configuration

The model endpoint is configured, not hardcoded. `src/config.ts` resolves it into a `ProviderConfig` and `src/ai.ts` builds an OpenAI-compatible provider from it with `createOpenAICompatible` (`@ai-sdk/openai-compatible`) — there is no per-provider package any more (`@ai-sdk/groq` was removed).

- Source of truth is `~/.kev/config.json`: `{ providerName, baseURL, model, apiKeyEnv }`, all optional. With no file, `DEFAULT_PROVIDER_CONFIG` gives the original Groq behavior, so an existing install is unchanged.
- Precedence, lowest to highest: built-in default → `config.json` → `KEV_*` env vars (`KEV_PROVIDER`, `KEV_BASE_URL`, `KEV_MODEL`, `KEV_API_KEY_ENV`, `KEV_API_KEY`). The key itself resolves as `env[apiKeyEnv]`, then `KEV_API_KEY`, then an inline `apiKey`; a missing key is allowed (Ollama needs none) and only fails at request time.
- `resolveProviderConfig({ path, env })` is pure and sync (no async, so the hero can read it) and throws a descriptive `Error` for malformed JSON, a non-object file, a bad field type, or a non-http(s) `baseURL`. `getProviderConfig()` memoizes it for the process, logs a failure once through `logError`, and rethrows with context — the chat surfaces that message. Editing the file therefore requires a restart.
- `getModelLabel()` derives the status-line name from `model` and never throws (falls back to `"no model"`); `HomeHero` uses it instead of importing a model id from `ai.ts`.
- Keep secrets out of the config file: name the env var in `apiKeyEnv` rather than pasting a key.

## Built-in commands

Alongside user commands, the palette lists built-in entries that act on the TUI itself rather than running a script. They live in `src/builtins.ts` as `BuiltinCommand` entries (`kind: "builtin"`, no `type` or `script`) and merge with file-backed commands into a `PaletteCommand` union; `App.tsx` pins them first and `isBuiltinCommand` is the discriminant. `CommandPalette` tags them `tui`.

- Built-ins never launch a process and never touch `src/exec.ts` or `src/tools.ts`. Each one has a handler in `App.tsx` (`runBuiltin`), and `requestRun` short-circuits to it before the params/dangerous flow.
- Their names are reserved: `parseCommandFile` rejects anything in `BUILTIN_NAMES`, so `createCommandFile`/`updateCommandFile` fail for the model and a stray file shows up as a palette load error. The model cannot see built-ins (`listCommands` reads files only) and the system prompt tells it not to create them.
- `new-session` clears the transcript and resets draft/overlays; `resume-session` opens the `SessionPicker` overlay and loads a chosen session from disk. Both abort any in-flight run (`activeRunRef`) or AI stream (`streamControllerRef`) through the shared `clearInFlight`, whose `sessionEpochRef` bump keeps the aborted work from writing an error or partial message into the fresh/deferred session. `streamText` receives the controller's `abortSignal`.