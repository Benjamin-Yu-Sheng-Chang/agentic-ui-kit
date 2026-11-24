/**
 * The slash command a prompt starts with (`/name`, then whitespace or the end) and the text after it.
 * A name holds no further slash, so a path such as `/tmp/out.txt` is not a command.
 */
export function splitCommand(text: string): { command: string; rest: string } | null {
  const m = /^\/[A-Za-z][\w.:-]*(?=\s|$)/.exec(text);
  return m ? { command: m[0], rest: text.slice(m[0].length) } : null;
}
