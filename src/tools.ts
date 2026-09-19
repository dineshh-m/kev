import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { jsonSchema, tool, type ToolSet } from "ai";

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

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
};