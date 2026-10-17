import { homedir } from "node:os";
import { join } from "node:path";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";

const LOG_DIR = join(homedir(), ".kev");
const LOG_FILE = join(LOG_DIR, "kev.log");
const OLD_LOG_FILE = join(LOG_DIR, "kev.log.old");
const MAX_LOG_BYTES = 1024 * 1024;

let writeChain: Promise<void> = Promise.resolve();
let dirReady = false;

async function rotateIfNeeded() {
  try {
    const info = await stat(LOG_FILE);
    if (info.size >= MAX_LOG_BYTES) {
      await rename(LOG_FILE, OLD_LOG_FILE);
    }
  } catch {
    // missing or unreadable log file: nothing to rotate
  }
}

async function append(line: string) {
  if (!dirReady) {
    await mkdir(LOG_DIR, { recursive: true });
    dirReady = true;
  }
  await rotateIfNeeded();
  await appendFile(LOG_FILE, line);
}

function write(line: string) {
  writeChain = writeChain.then(async () => {
    try {
      await append(line);
    } catch {
      // logging must never throw or become an unhandled rejection
    }
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function log(message: string) {
  write(`[${new Date().toISOString()}] ${message}\n`);
}

export function logError(context: string, error: unknown) {
  write(
    `[${new Date().toISOString()}] ERROR ${context}: ${formatError(error)}\n`
  );
}
