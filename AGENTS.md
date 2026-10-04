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
- `src/commands.ts` — loads `~/.kev/commands/*.md` (YAML frontmatter + raw script body), validates, filters. No React here.
- `src/exec.ts` — runs a command locally with `Bun.spawn` (stdin ignored, stdout/stderr piped) and streams output back as events. Never invoked by the model.
- `src/transcript.ts` — the UI transcript as `TranscriptEntry[]`: chat messages and UI-only run entries, plus `chatMessages()` which is what the model gets. No React here.
- `src/tools.ts` — `readFile` / `listFiles` tools handed to the model via `streamText`.
- `src/theme.ts` — exports `syntaxStyle` (`SyntaxStyle.fromStyles`), consumed by the `<markdown>` component.
- `src/components/` — presentational components: `AiMessage`, `UserMessage`, `CommandRun`, `CommandPalette`, `Spinner`, `AsciiBanner`.

## Command execution

Selecting a palette entry runs the command on the client. Nothing about the run is sent to the model.

- A run is a `{ kind: "run" }` transcript entry (`src/transcript.ts`), not a `UIMessage`. It carries no text or data parts, so it cannot be serialized into model context; `chatMessages()` filters runs out before `streamAssistantResponse` sees anything. The model is not even told that a command ran.
- Only one thing runs at a time — `status` in `App.tsx` is `"idle" | "streaming" | "running"`.
- Esc cancels a running command via an `AbortController`. Ctrl+C is *not* wired up for this: OpenTUI installs its own SIGINT handler that calls `renderer.destroy()`.
- `dangerous: true` in the frontmatter forces a y/n confirm in the palette footer. Esc or any other key cancels.
- Output is capped in the accumulator (`OUTPUT_CHAR_BUDGET`, `OUTPUT_MAX_LINES`), not via `maxBufferBytes`, which would kill the process.
- Cancellation is detected from a non-null exit signal, not `Subprocess.killed` — that field is true after ordinary exits too.