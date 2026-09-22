/** Parses a newline-delimited JSON stream body into an array of objects. */
export function parseNDJSON(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}
