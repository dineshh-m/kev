import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export const COMMANDS_DIR = join(homedir(), ".kev", "commands");

export const COMMAND_TYPES = ["bash", "python"] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

/**
 * A value the user is prompted for before a command runs. The resolved value is
 * exported to the script as the environment variable `KEV_PARAM_<NAME>` (see
 * `paramEnvName`), so a script never has to interpolate untrusted text.
 */
export interface CommandParam {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
}

export interface KevCommand {
  name: string;
  description: string;
  type: CommandType;
  script: string;
  dangerous: boolean;
  params: CommandParam[];
  path: string;
}

export interface LoadedCommands {
  commands: KevCommand[];
  errors: string[];
}

/** Every field a command needs to exist. */
export interface CommandInput {
  name: string;
  description: string;
  type: CommandType;
  script: string;
  dangerous?: boolean;
  params?: CommandParam[];
}

/**
 * An edit to an existing command. Omitted fields keep their current value, so a
 * patch that only carries `script` cannot accidentally clear `dangerous`.
 */
export type CommandPatch = { name: string } & Partial<Omit<CommandInput, "name">>;

export interface UpdatedCommand {
  command: KevCommand;
  changed: string[];
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
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

/** The environment variable a parameter is exposed as: `who` -> `KEV_PARAM_WHO`. */
export function paramEnvName(name: string): string {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `KEV_PARAM_${normalized}`;
}

/** Resolve parameter values into the environment the script runs with. */
export function buildParamEnv(values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    env[paramEnvName(name)] = value;
  }
  return env;
}

function optionalString(param: Record<string, unknown>, key: string): string | undefined {
  const value = param[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`parameter "${param.name}.${key}" must be a string`);
  }
  return value;
}

function parseParamName(raw: unknown, index: number): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`parameter ${index + 1} needs a non-empty "name"`);
  }
  const name = raw.trim();
  if (!PARAM_NAME_PATTERN.test(name)) {
    throw new Error(`parameter "name" must match ${PARAM_NAME_PATTERN.source}, got "${name}"`);
  }
  return name;
}

function parseParams(value: unknown): CommandParam[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`"params" must be a list`);
  }

  const params: CommandParam[] = [];
  const names = new Set<string>();
  const envNames = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`parameter ${index + 1} must be a key/value mapping`);
    }
    const name = parseParamName(entry.name, index);
    if (names.has(name)) {
      throw new Error(`duplicate parameter name "${name}"`);
    }
    names.add(name);

    const envName = paramEnvName(name);
    if (envNames.has(envName)) {
      throw new Error(`parameter "${name}" collides with another as ${envName}`);
    }
    envNames.add(envName);

    const param: CommandParam = { name };
    const description = optionalString(entry, "description");
    if (description !== undefined) param.description = description;
    const fallback = optionalString(entry, "default");
    if (fallback !== undefined) param.default = fallback;
    if (entry.required !== undefined) {
      if (typeof entry.required !== "boolean") {
        throw new Error(`parameter "${name}.required" must be a boolean`);
      }
      param.required = entry.required;
    }
    params.push(param);
  });

  return params;
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
    params: parseParams(header.params),
    path,
  };
}

export function serializeCommand(
  command: Omit<KevCommand, "path" | "dangerous" | "params"> & {
    dangerous?: boolean;
    params?: CommandParam[];
  },
): string {
  const header = [
    `name: ${JSON.stringify(command.name)}`,
    `description: ${JSON.stringify(command.description)}`,
    `type: ${JSON.stringify(command.type)}`,
    ...(command.dangerous ? [`dangerous: true`] : []),
  ];

  const params = command.params ?? [];
  if (params.length > 0) {
    header.push("params:");
    for (const param of params) {
      header.push(`  - name: ${JSON.stringify(param.name)}`);
      if (param.description !== undefined) {
        header.push(`    description: ${JSON.stringify(param.description)}`);
      }
      if (param.default !== undefined) {
        header.push(`    default: ${JSON.stringify(param.default)}`);
      }
      if (param.required !== undefined) {
        header.push(`    required: ${param.required}`);
      }
    }
  }

  return `---\n${header.join("\n")}\n---\n\n${command.script.trim()}\n`;
}

export function commandPath(name: string, dir: string = COMMANDS_DIR): string {
  return join(dir, `${name}${COMMAND_EXTENSION}`);
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

/**
 * Serialize, validate, then write. Parsing the serialized text is what makes
 * this safe to expose to the model: `parseCommandFile` is the same validator
 * the palette uses, so a bad name, type or empty script fails here and nothing
 * reaches disk. Returns the parsed command, which is the ground truth for
 * what was actually stored.
 */
async function writeValidated(input: CommandInput, dir: string): Promise<KevCommand> {
  const content = serializeCommand(input);
  const path = commandPath(input.name, dir);
  const parsed = parseCommandFile(path, content);

  await mkdir(dir, { recursive: true });
  await writeFile(path, content, "utf8");

  return parsed;
}

export async function commandExists(name: string, dir: string = COMMANDS_DIR): Promise<boolean> {
  try {
    return (await stat(commandPath(name, dir))).isFile();
  } catch {
    return false;
  }
}

export async function readCommandFile(name: string, dir: string = COMMANDS_DIR): Promise<KevCommand> {
  const path = commandPath(name, dir);
  try {
    return parseCommandFile(path, await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`no command named "${name}" in ${dir}`);
    }
    throw error;
  }
}

export async function createCommandFile(
  input: CommandInput,
  dir: string = COMMANDS_DIR,
): Promise<KevCommand> {
  if (await commandExists(input.name, dir)) {
    throw new Error(`command "${input.name}" already exists, use updateCommand instead`);
  }
  return writeValidated(input, dir);
}

export async function updateCommandFile(
  patch: CommandPatch,
  dir: string = COMMANDS_DIR,
): Promise<UpdatedCommand> {
  const existing = await readCommandFile(patch.name, dir);

  const input: CommandInput = {
    name: existing.name,
    description: patch.description ?? existing.description,
    type: patch.type ?? existing.type,
    script: patch.script ?? existing.script,
    dangerous: patch.dangerous ?? existing.dangerous,
    params: patch.params ?? existing.params,
  };

  const changed: string[] = (["description", "type", "script", "dangerous"] as const).filter(
    (field) => input[field] !== existing[field],
  );
  if (JSON.stringify(input.params) !== JSON.stringify(existing.params)) {
    changed.push("params");
  }

  return { command: await writeValidated(input, dir), changed };
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
