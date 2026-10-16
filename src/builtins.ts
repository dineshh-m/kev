import type { KevCommand } from "./commands";

/**
 * Commands that act on the TUI itself rather than spawning a script. They have
 * no `type` or `script` and are never written to `~/.kev/commands`; their action
 * is dispatched by `App.tsx`. Built-ins are invisible to the model and cannot
 * be created or overwritten — see `BUILTIN_NAMES`, which `commands.ts` reserves.
 */
const definitions = [
  {
    kind: "builtin",
    name: "new-session",
    description: "Clear the transcript and start a fresh session",
  },
  {
    kind: "builtin",
    name: "resume-session",
    description: "Pick a previous session and continue it",
  },
] as const satisfies readonly {
  kind: "builtin";
  name: string;
  description: string;
}[];

export type BuiltinName = (typeof definitions)[number]["name"];

export interface BuiltinCommand {
  kind: "builtin";
  name: BuiltinName;
  description: string;
}

/** Everything that can appear in the '/' palette, in one union. */
export type PaletteCommand = KevCommand | BuiltinCommand;

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = definitions;

/** Names reserved for built-ins; user command files cannot use them. */
export const BUILTIN_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_COMMANDS.map((command) => command.name),
);

export function isBuiltinCommand(command: PaletteCommand): command is BuiltinCommand {
  return "kind" in command && command.kind === "builtin";
}
