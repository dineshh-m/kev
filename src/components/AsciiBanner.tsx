import type { ASCIIFontName } from "@opentui/core";
import { useMemo } from "react"
import type { ReactNode } from "react"


// Glyphs are 9 wide x 16 tall "pixels" with 3px strokes, like the Omarchy logo.
// Each terminal cell holds 1 pixel horizontally and 2 vertically (half-blocks),
// so pixels stay square and the banner is only 8 text rows tall.
const GLYPH_WIDTH = 9
const GLYPH_HEIGHT = 16

const FONT: Record<string, string[]> = {
  K: [
    "###...###",
    "###...###",
    "###..###.",
    "###.###..",
    "#######..",
    "######...",
    "#####....",
    "#####....",
    "######...",
    "#######..",
    "###.###..",
    "###..###.",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
  ],
  E: [
    "#########",
    "#########",
    "###......",
    "###......",
    "###......",
    "###......",
    "###......",
    "#######..",
    "#######..",
    "###......",
    "###......",
    "###......",
    "###......",
    "###......",
    "#########",
    "#########",
  ],
  V: [
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    ".###.###.",
    "..#####..",
    "..#####..",
    "..#####..",
    "...###...",
    "...###...",
    "...###...",
  ],
  O: [
    "..#####..",
    ".#######.",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    "###...###",
    ".#######.",
    "..#####..",
  ],
  " ": Array(GLYPH_HEIGHT).fill(".".repeat(GLYPH_WIDTH)),
  // Add more letters here as needed (9 wide x 16 tall)
}

// One color per pixel row (16), top -> bottom. Hard bands like the Omarchy logo.
export const DEFAULT_GRADIENT = [
  ...Array(4).fill("#d0fcd8"),
  ...Array(2).fill("#a6fcbb"),
  ...Array(4).fill("#86fca0"),
  ...Array(3).fill("#52a068"),
  ...Array(3).fill("#2c5236"),
]

export interface BannerProps {
  /** Text to render. Characters without a glyph render as blank space. */
  text?: string
  /** Color for each pixel row, top to bottom (16 entries). */
  gradient?: string[]
  /** Blank pixel columns between letters. */
  letterSpacing?: number
}

function buildGrid(text: string, letterSpacing: number): string[] {
  const gap = ".".repeat(letterSpacing)
  const blank = FONT[" "] ?? []
  const glyphs = [...text.toUpperCase()].map((ch) => FONT[ch] ?? blank)
  return Array.from({ length: GLYPH_HEIGHT }, (_, y) =>
    glyphs.map((g) => g[y] ?? "").join(gap),
  )
}

// Turns two pixel rows into one text row using ▀ ▄ █ with fg/bg colors.
function renderTextRow(grid: string[], gradient: string[], r: number): ReactNode[] {
  const color = (y: number) => gradient[y] ?? gradient[gradient.length - 1]
  const top = grid[r * 2] ?? ""
  const bottom = grid[r * 2 + 1] ?? ""
  const topColor = color(r * 2)
  const bottomColor = color(r * 2 + 1)

  const nodes: ReactNode[] = []
  let run = { text: "", fg: undefined as string | undefined, bg: undefined as string | undefined }

  const flush = () => {
    if (!run.text) return
    nodes.push(
      run.fg ? (
        <span key={nodes.length} fg={run.fg} bg={run.bg}>
          {run.text}
        </span>
      ) : (
        run.text
      ),
    )
    run = { text: "", fg: undefined, bg: undefined }
  }

  for (let x = 0; x < top.length; x++) {
    const t = top[x] === "#"
    const b = bottom[x] === "#"

    let ch = " "
    let fg: string | undefined
    let bg: string | undefined

    if (t && b) {
      if (topColor === bottomColor) {
        ch = "█"
        fg = topColor
      } else {
        ch = "▀" 
        fg = topColor
        bg = bottomColor
      }
    } else if (t) {
      ch = "▀"
      fg = topColor
    } else if (b) {
      ch = "▄"
      fg = bottomColor
    }

    if (fg !== run.fg || bg !== run.bg) flush()
    run.fg = fg
    run.bg = bg
    run.text += ch
  }
  flush()
  return nodes
}

export function Banner({
  text = "KEV",
  gradient = DEFAULT_GRADIENT,
  letterSpacing = 1,
}: BannerProps) {
  const rows = useMemo(() => {
    const grid = buildGrid(text, letterSpacing)
    return Array.from({ length: GLYPH_HEIGHT / 2 }, (_, r) =>
      renderTextRow(grid, gradient, r),
    )
  }, [text, gradient, letterSpacing])

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows.map((nodes, i) => (
        <text key={i}>{nodes}</text>
      ))}
    </box>
  )
}

export default Banner
