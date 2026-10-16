import { describe, expect, test } from "bun:test";
import { NAME_PATTERN, type KevCommand } from "./commands";
import { BUILTIN_COMMANDS, BUILTIN_NAMES, isBuiltinCommand } from "./builtins";

const userCommand: KevCommand = {
  name: "todos",
  description: "Count TODO comments",
  type: "bash",
  script: "rg -c TODO",
  dangerous: false,
  params: [],
  path: "/tmp/todos.md",
};

describe("built-ins", () => {
  test("names are unique and valid command names", () => {
    const names = BUILTIN_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(NAME_PATTERN);
  });

  test("BUILTIN_NAMES mirrors the registry", () => {
    expect(BUILTIN_NAMES.size).toBeGreaterThan(0);
    expect([...BUILTIN_NAMES].sort()).toEqual(BUILTIN_COMMANDS.map((c) => c.name).sort());
  });

  test("registry entries are recognised as built-ins", () => {
    for (const command of BUILTIN_COMMANDS) expect(isBuiltinCommand(command)).toBe(true);
  });

  test("script commands are not built-ins", () => {
    expect(isBuiltinCommand(userCommand)).toBe(false);
  });
});
