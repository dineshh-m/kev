import { TextAttributes } from "@opentui/core";
import type { RunData, RunStatus } from "../exec";
import { Spinner } from "./Spinner";

const STATUSES: RunStatus[] = ["running", "done", "failed", "error", "cancelled"];

const STATUS_GLYPH: Record<RunStatus, string> = {
  running: "",
  done: "✓",
  failed: "✗",
  error: "!",
  cancelled: "⊘",
};

const STATUS_FG: Record<RunStatus, string> = {
  running: "#A5D6A7",
  done: "#73D08A",
  failed: "#E5484D",
  error: "#E5484D",
  cancelled: "#7A8A80",
};

function toRunData(data: unknown): RunData | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.status !== "string") return null;
  if (!STATUSES.includes(record.status as RunStatus)) return null;

  return {
    name: record.name,
    type: record.type === "python" ? "python" : "bash",
    status: record.status as RunStatus,
    stdout: typeof record.stdout === "string" ? record.stdout : "",
    stderr: typeof record.stderr === "string" ? record.stderr : "",
    code: typeof record.code === "number" ? record.code : null,
    signal: typeof record.signal === "string" ? record.signal : null,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
    truncated: record.truncated === true,
  };
}

function statusLine(run: RunData): string {
  if (run.status === "running") return "running — esc to cancel";
  if (run.status === "error") return "failed to start";

  const parts: string[] = [];
  if (run.code !== null) parts.push(`exit ${run.code}`);
  if (run.signal) parts.push(`signal ${run.signal}`);
  if (parts.length === 0) parts.push(run.status);
  return `${parts.join(" · ")} · ${run.durationMs}ms`;
}

export function CommandRun({ data }: { data: unknown }) {
  const run = toRunData(data);
  if (!run) return null;

  const running = run.status === "running";
  const hasOutput = run.stdout.length > 0 || run.stderr.length > 0;

  return (
    <box
      width="100%"
      paddingLeft={1}
      marginBottom={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor="#0e0e0e"
      border={["left"]}
      borderColor={running ? "#4A6352" : STATUS_FG[run.status]}
    >
      <box flexDirection="row" height={1}>
        {running ? <Spinner /> : <text fg={STATUS_FG[run.status]}>{STATUS_GLYPH[run.status]} </text>}
        <text fg="#8BC34A">{`/${run.name}`}</text>
        <text fg={STATUS_FG[run.status]} attributes={TextAttributes.DIM}>{`  ${statusLine(run)}`}</text>
      </box>

      {hasOutput ? (
        <box flexDirection="column" marginTop={1}>
          {run.stdout.length > 0 ? (
            <text fg="#7A8A80" attributes={TextAttributes.DIM}>
              {run.stdout}
            </text>
          ) : null}
          {run.stderr.length > 0 ? (
            <text fg="#E5484D" attributes={TextAttributes.DIM}>
              {run.stderr}
            </text>
          ) : null}
        </box>
      ) : null}

      {run.truncated ? (
        <text fg="#4A6352" attributes={TextAttributes.DIM}>
          … output truncated
        </text>
      ) : null}
    </box>
  );
}
