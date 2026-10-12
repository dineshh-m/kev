import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCommandFile,
  loadCommands,
  parseCommandFile,
  readCommandFile,
  serializeCommand,
  updateCommandFile,
  type CommandInput,
  type CommandType,
  type KevCommand,
} from "./commands";

function raw(body: string, header: string[] = []): string {
  return `---\n${["name: \"demo\"", 'description: "A demo command"', 'type: "bash"', ...header].join(
    "\n",
  )}\n---\n\n${body}\n`;
}

describe("parseCommandFile", () => {
  test("reads name, description, type and script", () => {
    const command = parseCommandFile("/tmp/demo.md", raw("echo hi"));
    expect(command).toMatchObject({
      name: "demo",
      description: "A demo command",
      type: "bash",
      script: "echo hi",
      dangerous: false,
    });
  });

  test("defaults dangerous to false when the key is absent", () => {
    expect(parseCommandFile("/tmp/demo.md", raw("echo hi")).dangerous).toBe(false);
  });

  test("reads dangerous: true", () => {
    expect(parseCommandFile("/tmp/demo.md", raw("rm -rf /", ["dangerous: true"])).dangerous).toBe(
      true,
    );
  });

  test("reads dangerous: false explicitly", () => {
    expect(parseCommandFile("/tmp/demo.md", raw("echo hi", ["dangerous: false"])).dangerous).toBe(
      false,
    );
  });

  test("rejects a non-boolean dangerous", () => {
    expect(() => parseCommandFile("/tmp/demo.md", raw("rm -rf /", ['dangerous: "yes"']))).toThrow(
      /"dangerous" must be a boolean/,
    );
  });

  test("rejects a name that disagrees with the filename", () => {
    expect(() => parseCommandFile("/tmp/other.md", raw("echo hi"))).toThrow(/the file is named/);
  });

  test("rejects an empty script body", () => {
    expect(() => parseCommandFile("/tmp/demo.md", raw("   \n"))).toThrow(/script body is empty/);
  });

  test("rejects an unknown type", () => {
    const bad = `---\nname: "demo"\ndescription: "d"\ntype: "zsh"\n---\n\necho hi\n`;
    expect(() => parseCommandFile("/tmp/demo.md", bad)).toThrow(/"type" must be one of/);
  });
});

describe("serializeCommand", () => {
  test("omits dangerous when false so existing files round-trip byte for byte", () => {
    const serialized = serializeCommand({
      name: "changed-files",
      description: "List all changed files in the current Git repository",
      type: "bash",
      script: "git diff --name-only",
    });
    expect(serialized).toBe(
      '---\nname: "changed-files"\ndescription: "List all changed files in the current Git ' +
        'repository"\ntype: "bash"\n---\n\ngit diff --name-only\n',
    );
  });

  test("emits dangerous only when true", () => {
    expect(serializeCommand({
      name: "nuke",
      description: "Remove build output",
      type: "bash",
      script: "rm -rf dist",
      dangerous: true,
    })).toContain('type: "bash"\ndangerous: true\n---');
  });

  test("round-trips through parseCommandFile", () => {
    const command: Omit<KevCommand, "path" | "dangerous"> & { dangerous?: boolean } = {
      name: "demo",
      description: "A demo command",
      type: "python",
      script: "print('hi')",
      dangerous: true,
    };
    const parsed = parseCommandFile("/tmp/demo.md", serializeCommand(command));
    expect(parsed).toMatchObject(command);
  });
});

describe("command writes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kev-commands-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function input(overrides: Partial<CommandInput> = {}): CommandInput {
    return {
      name: "todos",
      description: "Count TODO comments",
      type: "bash",
      script: "rg -c TODO",
      ...overrides,
    };
  }

  test("create writes a file that loads back cleanly", async () => {
    const created = await createCommandFile(input(), dir);
    expect(created).toMatchObject({ name: "todos", type: "bash", dangerous: false });

    const { commands, errors } = await loadCommands(dir);
    expect(errors).toEqual([]);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ name: "todos", script: "rg -c TODO" });
  });

  test("create makes the commands directory when it is missing", async () => {
    const nested = join(dir, "nested");
    await createCommandFile(input(), nested);
    expect((await loadCommands(nested)).commands).toHaveLength(1);
  });

  test("create refuses to clobber an existing command", async () => {
    await createCommandFile(input(), dir);
    await expect(createCommandFile(input({ script: "echo other" }), dir)).rejects.toThrow(
      /already exists/,
    );
    expect((await readCommandFile("todos", dir)).script).toBe("rg -c TODO");
  });

  test("an invalid command is never written", async () => {
    await expect(createCommandFile(input({ name: "Bad Name" }), dir)).rejects.toThrow();
    await expect(createCommandFile(input({ name: "blank", script: "   " }), dir)).rejects.toThrow();
    await expect(
      createCommandFile(input({ name: "zshy", type: "zsh" as CommandType }), dir),
    ).rejects.toThrow();
    expect((await loadCommands(dir)).commands).toEqual([]);
  });

  test("update merges, leaving omitted fields alone", async () => {
    await createCommandFile(input({ dangerous: true }), dir);

    const { command, changed } = await updateCommandFile(
      { name: "todos", script: "rg -c TODO src" },
      dir,
    );

    expect(changed).toEqual(["script"]);
    expect(command).toMatchObject({
      description: "Count TODO comments",
      type: "bash",
      script: "rg -c TODO src",
      dangerous: true,
    });
  });

  test("update reports every field it moved", async () => {
    await createCommandFile(input(), dir);

    const { changed } = await updateCommandFile(
      { name: "todos", description: "List TODOs", type: "python", script: "pass", dangerous: true },
      dir,
    );

    expect(changed).toEqual(["description", "type", "script", "dangerous"]);
  });

  test("update can clear dangerous, not just set it", async () => {
    await createCommandFile(input({ dangerous: true }), dir);

    const { command, changed } = await updateCommandFile({ name: "todos", dangerous: false }, dir);

    expect(changed).toEqual(["dangerous"]);
    expect(command.dangerous).toBe(false);
    // Re-read from disk: the flag has to be gone from the file, not just from
    // the returned object.
    expect((await readCommandFile("todos", dir)).dangerous).toBe(false);
  });

  test("update to a no-op changes nothing", async () => {
    await createCommandFile(input(), dir);
    const { command, changed } = await updateCommandFile({ name: "todos" }, dir);
    expect(changed).toEqual([]);
    expect(command.script).toBe("rg -c TODO");
  });

  test("update on a missing command throws instead of creating one", async () => {
    await expect(updateCommandFile({ name: "ghost", script: "echo hi" }, dir)).rejects.toThrow(
      /no command named/,
    );
    expect((await loadCommands(dir)).commands).toEqual([]);
  });

  test("reading a missing command names the directory", async () => {
    await expect(readCommandFile("ghost", dir)).rejects.toThrow(new RegExp(`no command named "ghost" in ${dir}`));
  });
});
