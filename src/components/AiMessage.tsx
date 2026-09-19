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
      {message.toolCalls.map((tool) => (
        <box
          key={tool.id}
          width="100%"
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
          marginBottom={1}
          border={["left"]}
          borderColor={tool.status === "error" ? "#E5484D" : "#73D08A"}
        >
          <text
            fg={tool.status === "done" ? "#73D08A" : tool.status === "error" ? "#E5484D" : "#A5D6A7"}
          >
            {tool.status === "running" ? "●" : tool.status === "done" ? "✓" : "✗"} {tool.name}
          </text>
          {argsPreview(tool) ? (
            <text attributes={TextAttributes.DIM}>
              {"  "}
              {argsPreview(tool)}
            </text>
          ) : null}
          {tool.status === "done" && tool.result ? (
            <text attributes={TextAttributes.DIM}>
              {"  → "}
              {tool.result}
            </text>
          ) : null}
          {tool.status === "error" && tool.error ? (
            <text attributes={TextAttributes.DIM}>
              {"  → "}
              {tool.error}
            </text>
          ) : null}
        </box>
      ))}
      <markdown
        content={message.content}
        syntaxStyle={syntaxStyle}
        streaming={message.streaming ?? false}
      />
    </box>
  );
}