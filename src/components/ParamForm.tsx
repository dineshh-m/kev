import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import type { CommandParam, KevCommand } from "../commands";

function paramLabel(param: CommandParam): string {
  const label = param.description?.trim() || param.name;
  return param.required ? `${label} *` : label;
}

interface ParamFormProps {
  command: KevCommand;
  values: string[];
  focusedIndex: number;
  error: string | null;
  onChange: (index: number, value: string) => void;
  onSubmit: (index: number) => void;
}

export function ParamForm({
  command,
  values,
  focusedIndex,
  error,
  onChange,
  onSubmit,
}: ParamFormProps) {
  const { width } = useTerminalDimensions();

  const labelWidth = Math.min(
    command.params.reduce((widest, param) => Math.max(widest, paramLabel(param).length), 0) + 2,
    Math.max(Math.floor(width / 3), 8),
  );
  const inputWidth = Math.max(width - 4 - labelWidth - 4, 8);
  const isLast = focusedIndex === command.params.length - 1;

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
      <box height={2}>
        <text fg="#8BC34A">{`/${command.name}`}</text>
        <text fg="#7A8A80" attributes={TextAttributes.DIM}>
          {`  fill in ${command.params.length} parameter${command.params.length === 1 ? "" : "s"}`}
        </text>
      </box>

      {command.params.map((param, index) => (
        <box key={param.name} flexDirection="row" height={3}>
          <box width={labelWidth} paddingTop={1}>
            <text fg={index === focusedIndex ? "#73D08A" : "#7A8A80"} wrapMode="none">
              {paramLabel(param)}
            </text>
          </box>
          <box
            border
            borderStyle="rounded"
            borderColor={index === focusedIndex ? "#4A6352" : "#232323"}
            width={inputWidth}
          >
            <input
              focused={index === focusedIndex}
              width="100%"
              value={values[index] ?? ""}
              placeholder={param.default ?? param.name}
              onInput={(value) => onChange(index, value)}
              onSubmit={() => onSubmit(index)}
            />
          </box>
        </box>
      ))}

      <box flexDirection="row" height={1}>
        <text
          fg={error ? "#E5484D" : "#3D5043"}
          attributes={error ? TextAttributes.BOLD : TextAttributes.DIM}
          wrapMode="none"
        >
          {error ??
            `tab/↑↓ move · enter ${isLast ? "run" : "next"} · esc cancel · values exported as KEV_PARAM_*`}
        </text>
      </box>
    </box>
  );
}
