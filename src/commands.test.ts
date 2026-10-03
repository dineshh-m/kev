import { describe, expect, test } from "bun:test";
import { parseCommandFile, serializeCommand, type KevCommand } from "./commands";

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
