import { TextAttributes } from "@opentui/core";
import { syntaxStyle } from "../theme";
import type { AiMessage, ToolCall } from "../types";

const ARGS_PREVIEW_LIMIT = 60;

function argsPreview(tool: ToolCall): string {
  const path = tool.args?.["path"];
  if (typeof path === "string") return `path = ${path}`;
  const text = tool.argsText.trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text;
}

export function AiMessage({ message }: { message: AiMessage }) {
  return (
    <box
      flexDirection="column"
      width="100%"
      paddingLeft={1}
      marginBottom={1}
    >
      {message.toolCalls.map((tool) => {
        const args = argsPreview(tool) ? ` ${argsPreview(tool)}` : "";
        const summary =
          tool.status === "done" && tool.result
            ? ` → ${tool.result}`
            : tool.status === "error" && tool.error
              ? ` → ${tool.error}`
              : "";
        return (
          <text
            key={tool.id}
            marginBottom={1}
            attributes={TextAttributes.DIM}
            fg={tool.status === "done" ? "#73D08A" : tool.status === "error" ? "#E5484D" : "#A5D6A7"}
          >
            {`${tool.status === "running" ? "●" : tool.status === "done" ? "✓" : "✗"} ${tool.name}${args}${summary}`}
          </text>
        );
      })}
      <markdown
        content={message.content}
        syntaxStyle={syntaxStyle}
        streaming={message.streaming ?? false}
      />
    </box>
  );
}