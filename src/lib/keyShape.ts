// Composio hands out two kinds of key that look alike, and pasting one
// where the other goes was the most common way connecting apps failed:
// the save went through, and nothing connected. Caught at the paste,
// before a round trip, and said in terms of what to go and copy instead.
export function composioKeyMistake(section: "composio" | "composioApi", value: string): string | null {
  const key = value.trim();
  if (!key) return null;
  if (section === "composio" && key.startsWith("ak_")) {
    return "That's a Composio API key (ak_). Paste the Connect key here. It starts with ck_.";
  }
  if (section === "composioApi" && key.startsWith("ck_")) {
    return "That's a Connect key (ck_), which goes with the Connect key. This one needs the API key (ak_).";
  }
  return null;
}
