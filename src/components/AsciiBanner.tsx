import type { ASCIIFontName } from "@opentui/core";

export const kevGradient = ["#1B5E40", "#2E7D4F", "#4C9E62", "#73D08A", "#98D99E", "#B8E994"];

export function AsciiBanner({ font = "tiny" }: { font?: ASCIIFontName }) {
  return <ascii-font text="KEV" font={font} color={"#4C9E62"} selectable={false} />;
}