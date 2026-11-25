export type ComposerCommand = {
  kind: "skill" | "asset";
  query: string;
  start: number;
  end: number;
};
export function composerCommand(
  text: string,
  caret: number,
): ComposerCommand | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)([/@])([^\s/@]*)$/u);
  if (!match) return null;
  return {
    kind: match[1] === "/" ? "skill" : "asset",
    query: match[2],
    start: caret - match[2].length - 1,
    end: caret,
  };
}
export function consumeCommand(text: string, command: ComposerCommand) {
  return text.slice(0, command.start) + text.slice(command.end);
}
