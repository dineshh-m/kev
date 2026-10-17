import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { isBuiltinCommand, type PaletteCommand } from "../builtins";

const MIN_SCRIPT_ROWS = 3;

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, max - 1)}…`;
}

interface CommandDetailProps {
  command: PaletteCommand;
  scroll: number;
}

export function CommandDetail({ command, scroll }: CommandDetailProps) {
  const { width, height } = useTerminalDimensions();

  const builtin = isBuiltinCommand(command);
  const dangerous = !builtin && command.dangerous;
  const params = builtin ? [] : command.params;
  const scriptLines = builtin ? [] : command.script.split("\n");

  // Root padding + the input box under the overlay.
  const reservedRows = 5;
  const borderRows = 2;
  const footerRows = 1;
  const rowsAboveScript = 4;
  const paramRows = Math.max(params.length, 1);
  const scriptRows = Math.max(
    MIN_SCRIPT_ROWS,
    height - reservedRows - borderRows - footerRows - rowsAboveScript - paramRows,
  );

  const start = Math.min(scroll, Math.max(scriptLines.length - scriptRows, 0));
  const visibleScript = scriptLines.slice(start, start + scriptRows);

  const contentWidth = Math.max(width - 8, 8);
  const nameWidth = Math.min(command.name.length + 1, Math.floor(contentWidth / 2));
  const tag = builtin ? "tui" : command.type;
  const tagText = dangerous ? `⚠ dangerous  ${tag}` : tag;

  return (
    <box
      position="absolute"
      left={0}
      right={0}
      bottom="100%"
      zIndex={10}
      flexDirection="column"
      backgroundColor="#0e0e0e"
      paddingLeft={1}
      paddingRight={1}
      border
      borderStyle="rounded"
      borderColor="#232323"
    >
      <box flexDirection="row" height={1}>
        <text width={nameWidth} fg="#8BC34A" wrapMode="none">
          {`/${command.name}`}
        </text>
        <box flexGrow={1} />
        <text
          fg={dangerous ? "#E5484D" : "#4A6352"}
          attributes={TextAttributes.DIM}
          wrapMode="none"
        >
          {truncate(tagText, Math.max(contentWidth - nameWidth, 8))}
        </text>
      </box>
      <box height={1}>
        <text fg="#7A8A80" attributes={TextAttributes.DIM} wrapMode="none">
          {truncate(command.description, contentWidth)}
        </text>
      </box>

      {builtin ? (
        <box height={1}>
          <text fg="#6C8EBF" attributes={TextAttributes.DIM} wrapMode="none">
            tui builtin — acts on the app itself, no script or params
          </text>
        </box>
      ) : (
        <>
          <box height={1}>
            <text fg="#3D5043" attributes={TextAttributes.DIM} wrapMode="none">
              {params.length > 0 ? `params (${params.length}):` : "params:"}
            </text>
          </box>
          {params.length === 0 ? (
            <box height={1}>
              <text fg="#7A8A80" attributes={TextAttributes.DIM} wrapMode="none">
                {"none"}
              </text>
            </box>
          ) : (
            params.map((param) => {
              const label = param.name;
              const meta: string[] = [];
              if (param.description) meta.push(param.description);
              if (param.default !== undefined) meta.push(`default: ${param.default}`);
              if (param.required) meta.push("required");
              const gap = 2;
              const metaWidth = Math.max(contentWidth - label.length - gap, 8);
              return (
                <box key={param.name} flexDirection="row" height={1}>
                  <text width={label.length + gap} fg="#8BC34A" wrapMode="none">
                    {label}
                  </text>
                  <text fg="#7A8A80" attributes={TextAttributes.DIM} wrapMode="none">
                    {truncate(meta.join(" · "), metaWidth)}
                  </text>
                </box>
              );
            })
          )}
          <box height={1}>
            <text fg="#3D5043" attributes={TextAttributes.DIM} wrapMode="none">
              {"script:"}
            </text>
          </box>
          {visibleScript.map((line, offset) => (
            <text
              key={start + offset}
              fg="#A5D6A7"
              attributes={TextAttributes.DIM}
              wrapMode="none"
            >
              {truncate(line === "" ? " " : line, contentWidth)}
            </text>
          ))}
        </>
      )}

      <box flexDirection="row" height={1}>
        <text fg="#3D5043" attributes={TextAttributes.DIM} wrapMode="none">
          {builtin ? "esc back" : truncate("↑↓ scroll · esc back", Math.max(contentWidth - 12, 12))}
        </text>
        <box flexGrow={1} />
        {!builtin && scriptLines.length > scriptRows ? (
          <text fg="#3D5043" attributes={TextAttributes.DIM}>
            {`${start + 1}–${Math.min(start + scriptRows, scriptLines.length)}/${scriptLines.length}`}
          </text>
        ) : null}
      </box>
    </box>
  );
}
