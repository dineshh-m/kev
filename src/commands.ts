import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export const COMMANDS_DIR = join(homedir(), ".kev", "commands");

const COMMAND_TYPES = ["bash", "python"] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export interface KevCommand {
  name: string;
  description: string;
  type: CommandType;
  script: string;
  dangerous: boolean;
  path: string;
}

export interface LoadedCommands {
  commands: KevCommand[];
  errors: string[];
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const COMMAND_EXTENSION = ".md";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(header: Record<string, unknown>, key: string): string {
  const value = header[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function requireType(value: string): CommandType {
  if (!COMMAND_TYPES.includes(value as CommandType)) {
    throw new Error(`"type" must be one of ${COMMAND_TYPES.join(", ")}, got "${value}"`);
  }
  return value as CommandType;
}

function optionalBoolean(header: Record<string, unknown>, key: string): boolean {
  const value = header[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new Error(`"${key}" must be a boolean, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseCommandFile(path: string, raw: string): KevCommand {
  const frontmatter = FRONTMATTER.exec(raw);
  if (!frontmatter?.[1]) {
    throw new Error("missing '---' frontmatter block");
  }

  let header: unknown;
  try {
    header = Bun.YAML.parse(frontmatter[1]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid frontmatter: ${reason}`);
  }
  if (!isRecord(header)) {
    throw new Error("frontmatter must be a key/value mapping");
  }

  const name = requireString(header, "name");
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`"name" must match ${NAME_PATTERN.source}, got "${name}"`);
  }
  const fileName = basename(path, extname(path));
  if (fileName !== name) {
    throw new Error(`"name" is "${name}" but the file is named "${fileName}${COMMAND_EXTENSION}"`);
  }

  const script = raw.slice(frontmatter[0].length).replace(/^\r?\n/, "").trim();
  if (!script) {
    throw new Error("script body is empty");
  }

  return {
    name,
    description: requireString(header, "description"),
    type: requireType(requireString(header, "type")),
    script,
    dangerous: optionalBoolean(header, "dangerous"),
    path,
  };
}

export function serializeCommand(
  command: Omit<KevCommand, "path" | "dangerous"> & { dangerous?: boolean },
): string {
  const header = [
    `name: ${JSON.stringify(command.name)}`,
    `description: ${JSON.stringify(command.description)}`,
    `type: ${JSON.stringify(command.type)}`,
    ...(command.dangerous ? [`dangerous: true`] : []),
  ].join("\n");
  return `---\n${header}\n---\n\n${command.script.trim()}\n`;
}

export async function loadCommands(dir: string = COMMANDS_DIR): Promise<LoadedCommands> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { commands: [], errors: [] };
  }

  const files = entries.filter((entry) => entry.endsWith(COMMAND_EXTENSION)).sort();
  const results = await Promise.all(
    files.map(async (file): Promise<{ command: KevCommand } | { error: string }> => {
      const path = join(dir, file);
      try {
        return { command: parseCommandFile(path, await readFile(path, "utf8")) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { error: `${file}: ${reason}` };
      }
    }),
  );

  const commands: KevCommand[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if ("command" in result) {
      commands.push(result.command);
    } else {
      errors.push(result.error);
    }
  }
  commands.sort((a, b) => a.name.localeCompare(b.name));

  return { commands, errors };
}

export function filterCommands(commands: KevCommand[], query: string): KevCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;

  const byName = commands.filter((command) => command.name.toLowerCase().startsWith(needle));
  if (byName.length > 0) return byName;

  return commands.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) || command.description.toLowerCase().includes(needle),
  );
}
