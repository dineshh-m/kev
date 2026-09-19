import { TextAttributes } from "@opentui/core";

export function UserMessage({ content }: { content: string }) {
  return (
    <box
      width="100%"
      paddingLeft={1}
      marginBottom={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor="#0e0e0e"
      border={["left"]}
      borderColor="#73D08A"
    >
      <text attributes={TextAttributes.DIM}>{content}</text>
    </box>
  );
}