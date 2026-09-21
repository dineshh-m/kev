import { TextAttributes } from "@opentui/core";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { syntaxStyle } from "../theme";

const ARGS_PREVIEW_LIMIT = 60;

function argsPreview(input: unknown): string {
  if (input && typeof input === "object" && "path" in input && typeof input.path === "string") {
    return `path = ${input.path}`;
  }
  if (input === undefined || input === null) return "";
  const text = JSON.stringify(input).replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text;
}

function resultSummary(toolName: string, output: unknown): string {
  const record = output as Record<string, unknown>;
  if (toolName === "readFile") {
    const lines = typeof record.totalLines === "number" ? record.totalLines : "?";
    const bytes = typeof record.sizeBytes === "number" ? record.sizeBytes : 0;
    return `${lines} lines · ${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (toolName === "listFiles" && Array.isArray(record.entries)) {
    return `${record.entries.length} entries`;
  }
  const text = JSON.stringify(output);
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text;
}

export function AiMessage({ message }: { message: UIMessage }) {
  return (
    <box
      flexDirection="column"
      width="100%"
      paddingLeft={1}
      marginBottom={1}
    >
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <markdown
              key={index}
              content={part.text}
              syntaxStyle={syntaxStyle}
              streaming={part.state === "streaming"}
            />
          );
        }

        if (isToolUIPart(part)) {
          const name = getToolName(part);
          const running =
            part.state === "input-streaming" || part.state === "input-available";
          const done = part.state === "output-available";
          const failed = part.state === "output-error";
          // const args = running ? (argsPreview(part.input) ? ` ${argsPreview(part.input)}` : "") : "";
          const args =  (argsPreview(part.input) ? ` ${argsPreview(part.input)}` : "") ;
          const summary = done
            ? ` → ${resultSummary(name, part.output)}`
            : failed && typeof part.errorText === "string"
              ? ` → ${part.errorText}`
              : "";
          const fg = done ? "#73D08A" : failed ? "#E5484D" : "#A5D6A7";
          const status = failed ? "✗" : done ? "✓" : "●";
          return (
            <text
              key={part.toolCallId}
              marginBottom={1}
              attributes={TextAttributes.DIM}
              fg={fg}
            >
              {`${status} ${name}${args}${summary}`}
            </text>
          );
        }

        return null;
      })}
    </box>
  );
}