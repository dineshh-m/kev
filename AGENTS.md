# Agent Instructions

## Runtime

Bun >= 1.3.0 required. Do not use Node or npm. Bun auto-loads `.env`; copy `.env.example` to `.env` and set `GROQ_API_KEY` or AI replies fail.

## Commands

- `bun dev` — run in watch mode (`bun run --watch src/index.tsx`)
- `bun run typecheck` — type-check only (`tsc --noEmit`)
- No lint, test, or build commands exist. Interactive TUI, so there is no headless test path.

## Skill

The canonical OpenTUI reference is vendored at `.agents/skills/opentui` (see `skills-lock.json`). Load the `opentui` skill before adding or changing UI components/APIs.

## Framework

OpenTUI — a terminal UI framework built on React. JSX transform source is `@opentui/react` (not `react-dom`).

Components use OpenTUI primitives: `<box>`, `<text>`, `<markdown>`, `<input>`, `<scrollbox>`, etc. Do not use HTML/DOM elements.

## TypeScript

- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- Strict mode is on.

## Source layout

- `src/index.tsx` — entrypoint; wires `createCliRenderer` + `createRoot` from `@opentui/core`/`@opentui/react`, holds the chat UI state.
- `src/ai.ts` — streams assistant replies via the AI SDK (`streamText` with the Groq provider). No DOM or React here.
- `src/theme.ts` — exports `syntaxStyle` (`SyntaxStyle.fromStyles`), consumed by the `<markdown>` component.