/**
 * Terminal utilities.
 */

export function setTerminalTitle(title: string): void {
  process.stdout.write(`\x1b]2;${title}\x07`);
}