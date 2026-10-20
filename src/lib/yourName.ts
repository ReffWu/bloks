// The owner's name, as the window reads and saves it (server/owner-name.ts).
//
// The server keeps it and refuses to let anybody else see "The owner" in
// its place: sharing a room or inviting someone without a name answers
// 409 with code "name_required". This file is the window's half of that:
// whether an error is that refusal, what the name is and what the account
// suggests, and saving it. The asking is src/components/YourNameDialog.
import { api } from "@/state/store";

export const NAME_REQUIRED = "name_required";

/** What the server calls an owner who has not said (hostName). */
const UNNAMED = "The owner";

/** The owner's name as a route said it, or null for no name yet. */
export function ownerOrNull(name: string | null | undefined): string | null {
  const clean = name?.trim();
  return clean && clean !== UNNAMED ? clean : null;
}

/** Whether a failed call was refused for want of the owner's name. */
export function needsName(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === NAME_REQUIRED;
}

/** The name as saved (empty until given), and the one this computer's
 * account offers for the field, when this window is on that computer. */
export async function readYourName(): Promise<{ name: string; suggested: string | null }> {
  try {
    const said = await api("/api/profile/name");
    return { name: typeof said.name === "string" ? said.name : "", suggested: typeof said.suggested === "string" ? said.suggested : null };
  } catch {
    // a server from before the name had a route of its own
    return { name: "", suggested: null };
  }
}

/** Saves the name, and answers it as the server kept it (cleaned the way
 * every person's name is). Throws the server's refusal, in its words. */
export async function saveYourName(name: string): Promise<string> {
  const status = await api("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name } }) });
  return typeof status?.profile?.name === "string" ? status.profile.name : name.trim();
}
