import { SyntaxStyle } from "@opentui/core";

export const syntaxStyle = SyntaxStyle.fromStyles({
  "default":           { fg: "#C8C8C8" },
  "markup.heading":    { fg: "#73D08A", bold: true },
  "markup.strong":     { fg: "#FFFFFF", bold: true },
  "markup.italic":     { fg: "#C8C8C8", italic: true },
  "markup.raw":        { fg: "#73D08A" },
  "markup.raw.block":  { fg: "#C8C8C8" },
  "markup.link":       { fg: "#4A6352" },
  "markup.link.label": { fg: "#73D08A" },
  "markup.link.url":   { fg: "#7A8A80" },
  "markup.list":       { fg: "#73D08A" },
  "markup.quote":      { fg: "#7A8A80", italic: true },
  "conceal":           { fg: "#3D5043" },
});
