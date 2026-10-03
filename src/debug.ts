import { appendFile } from "node:fs/promises";

export async function log(message: string) {
  const timestamp = new Date().toISOString();

  await appendFile(
    "./app.log",
    `[${timestamp}] ${message}\n`
  );
}