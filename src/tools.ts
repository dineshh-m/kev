import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { jsonSchema, tool, type ToolSet } from "ai";
import {
  COMMAND_TYPES,
  createCommandFile,
  loadCommands,
  readCommandFile,
  updateCommandFile,
} from "./commands";

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

const NAME_PROPERTY = {
  type: "string",
  description:
    "Command name: kebab-case, lowercase letters, digits, dots, dashes and underscores.",
} as const;

const DESCRIPTION_PROPERTY = {
  type: "string",
  description: "One line shown next to the command in the palette.",
} as const;

const TYPE_PROPERTY = {
  type: "string",
  enum: [...COMMAND_TYPES],
  description: "Interpreter that runs the script body.",
} as const;

const DANGEROUS_PROPERTY = {
  type: "boolean",
  description:
    "Set true when the script deletes or overwrites data, rewrites history or remote refs, or changes permissions or running processes. The user is asked to confirm before a dangerous command runs.",
} as const;

const PARAMS_PROPERTY = {
  type: "array",
  description:
    "Values the user is prompted to fill in before the command runs. Each value is exported to the script as the environment variable KEV_PARAM_<UPPER_NAME>, so reference it in bash as $KEV_PARAM_<UPPER_NAME> or in Python as os.environ['KEV_PARAM_<UPPER_NAME>']. Omit when the command needs no input.",
  items: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Parameter name used in the env var, e.g. 'branch' -> KEV_PARAM_BRANCH.",
      },
      description: {
        type: "string",
        description: "Short label shown on the input the user fills in.",
      },
      default: {
        type: "string",
        description: "Pre-filled value. Leave off to start empty.",
      },
      required: {
        type: "boolean",
        description: "When true, the user cannot submit an empty value.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
} as const;

export const KevTools: ToolSet = {
  readFile: tool({
    description:
      "Read a text file from the local filesystem. Returns the full content, total line count and size in bytes. Optionally read only a line range.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path, absolute or relative to the working directory.",
        },
        startLine: {
          type: "number",
          description: "1-based first line to read (inclusive).",
        },
        endLine: {
          type: "number",
          description: "1-based last line to read (inclusive).",
        },
      },
      required: ["path"],
    }),
    execute: async ({ path, startLine, endLine }) => {
      const absolute = resolvePath(path);
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error(`${absolute} is not a file`);
      const lines = (await readFile(absolute, "utf8")).split("\n");
      const totalLines = lines.length;
      const from = Math.max(1, startLine ?? 1);
      const to = Math.min(totalLines, endLine ?? totalLines);
      return {
        filename: absolute,
        sizeBytes: info.size,
        totalLines,
        lineStart: from,
        lineEnd: to,
        content: lines.slice(from - 1, to).join("\n"),
      };
    },
  }),

  listFiles: tool({
    description:
      "List the entries of a directory on the local filesystem. Returns name, type and size for each entry, directories first.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path, absolute or relative to the working directory.",
        },
      },
      required: ["path"],
    }),
    execute: async ({ path }) => {
      const absolute = resolvePath(path);
      const info = await stat(absolute);
      if (!info.isDirectory()) throw new Error(`${absolute} is not a directory`);
      const entries = await readdir(absolute, { withFileTypes: true });
      const list = await Promise.all(
        entries.map(async (entry) => {
          let sizeBytes = 0;
          if (entry.isFile()) {
            try {
              sizeBytes = (await stat(join(absolute, entry.name))).size;
            } catch {
              sizeBytes = 0;
            }
          }
          return { name: entry.name, isDirectory: entry.isDirectory(), sizeBytes };
        }),
      );
      list.sort((a, b) =>
        a.isDirectory === b.isDirectory
          ? a.name.localeCompare(b.name)
          : a.isDirectory
            ? -1
            : 1,
      );
      return { path: absolute, entries: list };
    },
  }),

  listCommands: tool({
    description:
      "List every saved command: its name, description, type and whether it is dangerous. Call this before creating a command so you do not duplicate an existing one.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => {
      const { commands, errors } = await loadCommands();
      return {
        commands: commands.map(({ name, description, type, dangerous, params }) => ({
          name,
          description,
          type,
          dangerous,
          params: params.map((param) => param.name),
        })),
        errors,
      };
    },
  }),

  readCommand: tool({
    description:
      "Read one saved command by name, including its full script body. Call this before updating a command.",
    inputSchema: jsonSchema({
      type: "object",
      properties: { name: NAME_PROPERTY },
      required: ["name"],
      additionalProperties: false,
    }),
    execute: async ({ name }) => {
      const command = await readCommandFile(name);
      return {
        name: command.name,
        description: command.description,
        type: command.type,
        dangerous: command.dangerous,
        params: command.params,
        script: command.script,
        path: command.path,
      };
    },
  }),

  createCommand: tool({
    description:
      "Create a new command that the user can then run from the palette with '/'. Use this for commands that do not exist yet; use updateCommand for ones that do.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        name: NAME_PROPERTY,
        description: DESCRIPTION_PROPERTY,
        type: TYPE_PROPERTY,
        script: {
          type: "string",
          description:
            "The script body. It runs in the project directory, so reach for paths relative to the project rather than absolute ones. Parameter values arrive as KEV_PARAM_* environment variables.",
        },
        dangerous: DANGEROUS_PROPERTY,
        params: PARAMS_PROPERTY,
      },
      required: ["name", "description", "type", "script"],
      additionalProperties: false,
    }),
    execute: async ({ name, description, type, script, dangerous, params }) => {
      const command = await createCommandFile({ name, description, type, script, dangerous, params });
      return { name: command.name, path: command.path, created: true };
    },
  }),

  updateCommand: tool({
    description:
      "Change an existing command. Only the fields you pass are touched; omitted fields keep their current value. The name cannot be changed.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        name: { ...NAME_PROPERTY, description: "Name of the command to change." },
        description: DESCRIPTION_PROPERTY,
        type: TYPE_PROPERTY,
        script: {
          type: "string",
          description: "Replacement script body. Only needed when the script itself changes.",
        },
        dangerous: DANGEROUS_PROPERTY,
        params: PARAMS_PROPERTY,
      },
      required: ["name"],
      additionalProperties: false,
    }),
    execute: async ({ name, description, type, script, dangerous, params }) => {
      const { command, changed } = await updateCommandFile({
        name,
        ...(description === undefined ? {} : { description }),
        ...(type === undefined ? {} : { type }),
        ...(script === undefined ? {} : { script }),
        ...(dangerous === undefined ? {} : { dangerous }),
        ...(params === undefined ? {} : { params }),
      });
      return { name: command.name, path: command.path, updated: true, changed };
    },
  }),
};