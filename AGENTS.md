# Agent Instructions

## Runtime

Bun >= 1.3.0 required. Do not use Node or npm.

## Commands

- `bun dev` — run in watch mode
- `bun run typecheck` — type-check only (tsc --noEmit)
- No lint, test, or build commands exist.

## Framework

OpenTUI — a terminal UI framework built on React. JSX transform source is `@opentui/react` (not `react-dom`).

Components use OpenTUI primitives: `<box>`, `<text>`, `<ascii-font>`, etc. Do not use HTML/DOM elements.

## TypeScript

- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- Strict mode is on.

## Entry Point

`src/index.tsx` — single-file app.
