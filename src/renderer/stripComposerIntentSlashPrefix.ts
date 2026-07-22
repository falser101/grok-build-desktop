/**
 * After picking goal/loop from the `/` menu, strip the in-progress or complete
 * slash token so the composer does not keep a leftover `/…`. Body text after a
 * full `/goal` or `/loop [interval]` prefix is preserved.
 *
 * Pure helper — unit-tested without mounting React.
 */
export function stripComposerIntentSlashPrefix(
  draft: string,
  intent: "goal" | "loop",
): string {
  const text = draft ?? "";

  if (intent === "goal") {
    // Complete `/goal` or `/goal <body>`
    if (/^\s*\/goal(?:\s|$)/i.test(text)) {
      return text.replace(/^\s*\/goal\s*/i, "");
    }
  } else {
    // Complete `/loop`, `/loop <interval>`, or `/loop <interval> <body>`
    if (/^\s*\/loop(?:\s|$)/i.test(text)) {
      return text.replace(/^\s*\/loop(?:\s+\S+)?\s*/i, "");
    }
  }

  // Incomplete single-token slash while typing (`/`, `/g`, `/go`, `/lo`, …)
  // when the whole draft is only that token (optional trailing whitespace).
  const partial = text.match(/^\s*\/([A-Za-z]*)\s*$/);
  if (partial) {
    const name = (partial[1] ?? "").toLowerCase();
    const cmd = intent === "goal" ? "goal" : "loop";
    if (name.length === 0 || cmd.startsWith(name)) {
      return "";
    }
  }

  return text;
}
