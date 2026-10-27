// Composio hands out two kinds of key that look alike, and pasting one
// where the other goes was the most common way connecting apps failed:
// the save went through, and nothing connected. Caught at the paste,
// before a round trip, and said in terms of what to go and copy instead.
import { t } from "./i18n.ts";

export function composioKeyMistake(section: "composio" | "composioApi", value: string): string | null {
  const key = value.trim();
  if (!key) return null;
  if (section === "composio" && key.startsWith("ak_")) {
    return t("keyShape.apiKeyInConnect");
  }
  if (section === "composioApi" && key.startsWith("ck_")) {
    return t("keyShape.connectKeyInApi");
  }
  return null;
}
