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
- `src/ai.ts` — streams assistant replies via the AI SDK (`streamText` with the Groq provider). No DOM or React here.
- `src/commands.ts` — loads `~/.kev/commands/*.md` (YAML frontmatter + raw script body), validates, filters, and creates/updates command files. No React here.
- `src/exec.ts` — runs a command locally with `Bun.spawn` (stdin ignored, stdout/stderr piped) and streams output back as events. Never invoked by the model.
- `src/transcript.ts` — the UI transcript as `TranscriptEntry[]`: chat messages and UI-only run entries, plus `chatMessages()` which is what the model gets. No React here.
- `src/tools.ts` — the tools handed to the model via `streamText`: `readFile` / `listFiles` for project inspection, plus `listCommands` / `readCommand` / `createCommand` / `updateCommand` for authoring commands.
- `src/theme.ts` — exports `syntaxStyle` (`SyntaxStyle.fromStyles`), consumed by the `<markdown>` component.
- `src/components/` — presentational components: `AiMessage`, `UserMessage`, `CommandRun`, `CommandPalette`, `Spinner`, `AsciiBanner`.

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