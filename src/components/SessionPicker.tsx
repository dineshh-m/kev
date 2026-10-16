import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import type { SessionSummary } from "../sessions";

const MAX_VISIBLE = 8;
const MARKER_WIDTH = 2;

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, max - 1)}…`;
}

interface SessionPickerProps {
  sessions: SessionSummary[];
  selectedIndex: number;
  onSelect: (session: SessionSummary) => void;
}

export function SessionPicker({ sessions, selectedIndex, onSelect }: SessionPickerProps) {
  const { width } = useTerminalDimensions();

  const start =
    sessions.length > MAX_VISIBLE
      ? Math.min(Math.max(selectedIndex - MAX_VISIBLE + 1, 0), sessions.length - MAX_VISIBLE)
      : 0;
  const visible = sessions.slice(start, start + MAX_VISIBLE);
  const timeWidth = 12;
  const cwdWidth = Math.min(24, Math.max(Math.floor(width / 4), 8));
  const chrome = 2 + MARKER_WIDTH + timeWidth + cwdWidth + 3;
  const previewWidth = Math.max(width - chrome, 8);

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
      <box flexDirection="row" height={2}>
        <text fg="#8BC34A">resume-session</text>
        <text fg="#7A8A80" attributes={TextAttributes.DIM}>
          {`  ${sessions.length} saved session${sessions.length === 1 ? "" : "s"}`}
        </text>
      </box>

      {sessions.length === 0 ? (
        <box height={1}>
          <text fg="#7A8A80" attributes={TextAttributes.DIM}>
            No saved sessions yet — talk to Kev, then come back
          </text>
        </box>
      ) : (
        visible.map((session, offset) => {
          const index = start + offset;
          const isSelected = index === selectedIndex;
          return (
            <box
              key={session.id}
              flexDirection="row"
              height={1}
              backgroundColor={isSelected ? "#1c1c1c" : "transparent"}
            >
              <text width={MARKER_WIDTH} fg="#73D08A">
                {isSelected ? "▶" : " "}
              </text>
              <text
                width={previewWidth}
                fg={isSelected ? "#73D08A" : "#A5D6A7"}
                attributes={isSelected ? undefined : TextAttributes.DIM}
                wrapMode="none"
              >
                {truncate(session.preview, previewWidth)}
              </text>
              <text width={cwdWidth} fg="#7A8A80" attributes={TextAttributes.DIM} wrapMode="none">
                {truncate(session.cwd, cwdWidth)}
              </text>
              <text width={timeWidth} fg="#7A8A80" attributes={TextAttributes.DIM} wrapMode="none">
                {relativeTime(session.updatedAt)}
              </text>
            </box>
          );
        })
      )}

      <box flexDirection="row" height={1}>
        <text fg="#3D5043" attributes={TextAttributes.DIM} wrapMode="none">
          {sessions.length === 0
            ? "esc close"
            : truncate("↑↓ select · enter resume · esc close", Math.max(width - 12, 12))}
        </text>
        {sessions.length > 0 ? (
          <box flexGrow={1} />
        ) : null}
        {sessions.length > 0 ? (
          <text fg="#3D5043" attributes={TextAttributes.DIM}>
            {`${Math.min(selectedIndex + 1, sessions.length)}/${sessions.length}`}
          </text>
        ) : null}
      </box>
    </box>
  );
}
