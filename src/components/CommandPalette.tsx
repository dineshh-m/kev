import { MouseButton, TextAttributes, type MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { isBuiltinCommand, type PaletteCommand } from "../builtins";
import type { KevCommand } from "../commands";

const MAX_VISIBLE = 8;
const MARKER_WIDTH = 2;
const NAME_GAP = 2;
const TAG_WIDTH = 8;
const HORIZONTAL_CHROME = 2 + MARKER_WIDTH + TAG_WIDTH + 2;

interface CommandPaletteProps {
  commands: PaletteCommand[];
  totalCount: number;
  selectedIndex: number;
  errors: string[];
  confirm?: { command: KevCommand } | null;
  onSelect: (command: PaletteCommand) => void;
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, max - 1)}…`;
}

export function CommandPalette({
  commands,
  totalCount,
  selectedIndex,
  errors,
  confirm,
  onSelect,
}: CommandPaletteProps) {
  const { width } = useTerminalDimensions();

  const start =
    commands.length > MAX_VISIBLE
      ? Math.min(Math.max(selectedIndex - MAX_VISIBLE + 1, 0), commands.length - MAX_VISIBLE)
      : 0;
  const visible = commands.slice(start, start + MAX_VISIBLE);
  const nameWidth =
    visible.reduce((widest, command) => Math.max(widest, command.name.length + 1), 0) + NAME_GAP;
  const descriptionWidth = Math.max(width - HORIZONTAL_CHROME - nameWidth, 8);

  const handleMouseDown = (event: MouseEvent, command: PaletteCommand) => {
    if (event.button !== MouseButton.LEFT) return;
    event.preventDefault();
    onSelect(command);
  };

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
      {commands.length === 0 ? (
        <box height={1}>
          <text fg="#7A8A80" attributes={TextAttributes.DIM}>
            {totalCount === 0
              ? "No commands yet — ask Kev to create one in ~/.kev/commands"
              : "No command matches"}
          </text>
        </box>
      ) : (
        visible.map((command, offset) => {
          const index = start + offset;
          const isSelected = index === selectedIndex;
          const builtin = isBuiltinCommand(command);
          const dangerous = !builtin && command.dangerous;
          return (
            <box
              key={command.name}
              flexDirection="row"
              height={1}
              backgroundColor={isSelected ? "#1c1c1c" : "transparent"}
              onMouseDown={(event: MouseEvent) => handleMouseDown(event, command)}
            >
              <text width={MARKER_WIDTH} fg="#73D08A">
                {isSelected ? "▶" : dangerous ? "⚠" : " "}
              </text>
              <text width={nameWidth} fg={isSelected ? "#73D08A" : "#8BC34A"} wrapMode="none">
                {`/${command.name}`}
              </text>
              <text
                width={descriptionWidth}
                fg="#7A8A80"
                attributes={TextAttributes.DIM}
                wrapMode="none"
              >
                {truncate(command.description, descriptionWidth)}
              </text>
              <text
                width={TAG_WIDTH}
                fg={dangerous ? "#E5484D" : builtin ? "#6C8EBF" : "#4A6352"}
                attributes={TextAttributes.DIM}
                wrapMode="none"
              >
                {`${dangerous ? "⚠" : " "} ${builtin ? "tui" : command.type}`}
              </text>
            </box>
          );
        })
      )}
      <box flexDirection="row" height={1}>
        <text
          fg={confirm ? "#E5484D" : "#3D5043"}
          attributes={confirm ? TextAttributes.BOLD : TextAttributes.DIM}
          wrapMode="none"
        >
          {truncate(
            confirm
              ? `/${confirm.command.name} is marked dangerous — y to run, any other key to cancel`
              : errors.length > 0
                ? `↑↓ select · enter run · esc close · ⚠ ${errors.length} skipped: ${errors[0]}`
                : "↑↓ select · enter run · esc close",
            Math.max(width - 12, 12),
          )}
        </text>
        <box flexGrow={1} />
        {commands.length > 0 && !confirm ? (
          <text fg="#3D5043" attributes={TextAttributes.DIM}>
            {`${Math.min(selectedIndex + 1, commands.length)}/${commands.length}`}
          </text>
        ) : null}
      </box>
    </box>
  );
}
