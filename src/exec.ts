import { buildParamEnv, type CommandType, type KevCommand } from "./commands";
import { logError } from "./debug";

export const DEFAULT_TIMEOUT_MS = 120_000;

const DRAIN_GRACE_MS = 250;

export type RunStatus = "running" | "done" | "failed" | "error" | "cancelled";

export interface RunData {
  name: string;
  type: CommandType;
  status: RunStatus;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  durationMs: number;
  truncated: boolean;
}

export type RunEvent =
  | { type: "chunk"; stream: "stdout" | "stderr"; text: string }
  | {
      type: "exit";
      status: RunStatus;
      code: number | null;
      signal: NodeJS.Signals | null;
      durationMs: number;
    }
  | { type: "error"; message: string };

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  params?: Record<string, string>;
}

export function interpreterFor(type: CommandType): [string, string] {
  return type === "python" ? ["python3", "-c"] : ["bash", "-c"];
}

type PipedChild = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;

interface Settled {
  code: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
}

/**
 * Single-slot wakeup used to hand pipe chunks from their reader task to the
 * generator. The resolver is installed synchronously by `wait()`, and callers
 * always re-check the queue and the exit latch before awaiting, so a
 * notification can never be missed.
 */
class Wakeup {
  private resolver: (() => void) | null = null;

  wait(): Promise<void> {
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  notify(): void {
    this.resolver?.();
    this.resolver = null;
  }
}

type StreamName = "stdout" | "stderr";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPipe(
  stream: ReadableStream<Uint8Array>,
  name: StreamName,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();

    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value && value.byteLength > 0) {
            onEvent({ type: "chunk", stream: name, text: decoder.decode(value, { stream: true }) });
          }
        }
      } catch (error) {
        logError(`exec.readPipe:${name}`, error);
        onEvent({ type: "error", message: `failed reading ${name}: ${errorMessage(error)}` });
      } finally {
        reader.releaseLock();
        resolve();
      }
    };

    void pump();
  });
}

export async function* runCommand(
  command: KevCommand,
  options: RunOptions = {},
): AsyncGenerator<RunEvent, void, undefined> {
  const startedAt = performance.now();

  const queue: RunEvent[] = [];
  const wakeup = new Wakeup();
  let settled: Settled | null = null;

  const emit = (event: RunEvent) => {
    queue.push(event);
    wakeup.notify();
  };

  let child: PipedChild;
  try {
    child = Bun.spawn<"ignore", "pipe", "pipe">({
      cmd: [...interpreterFor(command.type), command.script],
      cwd: process.cwd(),
      env: { ...process.env, ...buildParamEnv(options.params ?? {}) },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: options.signal,
      onExit: (_subprocess, code, signalCode, error) => {
        settled = {
          code: typeof code === "number" ? code : null,
          signal: (signalCode as NodeJS.Signals | null) ?? null,
          error: error ? new Error(errorMessage(error)) : null,
        };
        wakeup.notify();
      },
    });
  } catch (error) {
    logError(`exec.spawn:${command.name}`, error);
    yield { type: "error", message: errorMessage(error) };
    return;
  }

  const pipes = Promise.all([
    readPipe(child.stdout, "stdout", emit),
    readPipe(child.stderr, "stderr", emit),
  ]);

  for (;;) {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) break;
      yield next;
    }

    if (settled !== null) break;
    await wakeup.wait();
  }

  // Non-null by the loop's exit condition; TypeScript cannot see that the
  // onExit callback ran.
  const result = settled as Settled;

  if (result.error) {
    logError(`exec.exit:${command.name}`, result.error);
    yield { type: "error", message: result.error.message };
    return;
  }

  // The child is gone but its pipes may still hold buffered output. Give the
  // readers a short window to finish, then stop waiting so a grandchild that
  // inherited the pipe cannot wedge the run.
  await Promise.race([pipes, Bun.sleep(DRAIN_GRACE_MS)]);

  for (;;) {
    const next = queue.shift();
    if (next === undefined) break;
    yield next;
  }

  const { code, signal } = result;
  yield {
    type: "exit",
    // `subprocess.killed` is true for ordinary exits too, so a non-null signal
    // is the only reliable evidence that we or the timeout stopped the child.
    status: signal !== null ? "cancelled" : code === 0 ? "done" : "failed",
    code,
    signal,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
