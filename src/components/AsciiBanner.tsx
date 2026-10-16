import type { ASCIIFontName } from "@opentui/core";
import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"


// Glyphs are 9 wide x 16 tall "pixels" with 3px strokes, like the Omarchy logo.
// Each terminal cell holds 1 pixel horizontally and 2 vertically (half-blocks),
// so pixels stay square and the banner is only 8 text rows tall.
const GLYPH_WIDTH = 9
const GLYPH_HEIGHT = 16
const TEXT_ROWS = GLYPH_HEIGHT / 2

// Draw-in: rows appear top to bottom, one every DRAW_STEP_MS.
const DRAW_STEP_MS = 40
// Shimmer: a brighter band sweeps down the gradient, then rests.
const SHIMMER_STEP_MS = 55
const SHIMMER_BAND = 5
const SHIMMER_STRENGTH = 0.5
const SHIMMER_SWEEP_MS = 1400
const SHIMMER_PAUSE_MS = 2600

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
  /** Reveal rows one-by-one on mount, then run the shimmer sweep. */
  animate?: boolean
}

function mixTowardWhite(hex: string, amount: number): string {
  const raw = hex.replace("#", "")
  if (raw.length !== 6) return hex
  const num = Number.parseInt(raw, 16)
  const channel = (shift: number) => {
    const value = (num >> shift) & 0xff
    return Math.round(value + (255 - value) * amount)
  }
  const pair = (value: number) => value.toString(16).padStart(2, "0")
  return `#${pair(channel(16))}${pair(channel(8))}${pair(channel(0))}`
}

// Lightens rows near `position` (pixel-row space) toward white.
function applyShimmer(gradient: string[], position: number | null): string[] {
  if (position === null) return gradient
  return gradient.map((color, y) => {
    const distance = Math.abs(y - position)
    if (distance >= SHIMMER_BAND) return color
    return mixTowardWhite(color, SHIMMER_STRENGTH * (1 - distance / SHIMMER_BAND))
  })
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
  animate = true,
}: BannerProps) {
  const [revealed, setRevealed] = useState(() => (animate ? 0 : TEXT_ROWS))
  const [shimmer, setShimmer] = useState<number | null>(null)

  useEffect(() => {
    if (!animate || revealed >= TEXT_ROWS) return
    const timer = setTimeout(() => setRevealed((count) => count + 1), DRAW_STEP_MS)
    return () => clearTimeout(timer)
  }, [animate, revealed])

  useEffect(() => {
    if (revealed < TEXT_ROWS) return
    const sweepSteps = Math.max(Math.ceil(SHIMMER_SWEEP_MS / SHIMMER_STEP_MS), 2)
    const cycleSteps = sweepSteps + Math.ceil(SHIMMER_PAUSE_MS / SHIMMER_STEP_MS)
    // Start inside the pause phase so the first sweep waits a beat.
    let step = sweepSteps
    const timer = setInterval(() => {
      step = (step + 1) % cycleSteps
      if (step >= sweepSteps) {
        setShimmer(null)
        return
      }
      const progress = step / (sweepSteps - 1)
      setShimmer(-SHIMMER_BAND + progress * (GLYPH_HEIGHT + SHIMMER_BAND * 2))
    }, SHIMMER_STEP_MS)
    return () => clearInterval(timer)
  }, [revealed])

  const rows = useMemo(() => {
    const grid = buildGrid(text, letterSpacing)
    const colors = applyShimmer(gradient, shimmer)
    return Array.from({ length: TEXT_ROWS }, (_, r) => ({
      width: (grid[r * 2] ?? "").length,
      nodes: renderTextRow(grid, colors, r),
    }))
  }, [text, gradient, letterSpacing, shimmer])

  return (
    <box flexDirection="column" flexShrink={0}>
      {rows.map((row, i) =>
        i < revealed ? (
          <text key={i}>{row.nodes}</text>
        ) : (
          // Hold the row's height so the draw-in does not reflow the layout.
          <text key={i}>{" ".repeat(row.width)}</text>
        ),
      )}
    </box>
  )
}

export default Banner
