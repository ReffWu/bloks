// "Share as file": a team or a skill as the server writes it, in the
// catalogue's own format with secrets and personal details taken out
// (server/catalog.ts), saved where the person keeps downloads. It saves
// rather than opens, because the point is to leave with it.

/** Fetches a shareable file and saves it under a name. Rejects with the
 * server's own words when it refuses. */
export async function shareAsFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path);
  if (!res.ok) {
    const said = await res.json().catch(() => null);
    throw new Error(said?.error ?? `That could not be saved (${res.status}).`);
  }
  const text = await res.text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A room's name as the file a catalogue keeps it in: teams/<id>.md. */
export function teamFilename(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "team"}.md`;
}
