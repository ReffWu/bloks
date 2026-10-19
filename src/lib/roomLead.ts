// Who wears the crown in a room, read the way the server decides it
// (leadOf in server/bloks.ts), so the crown is on whoever the room will
// actually wait for: the member the person chose, while that member is
// in the list given, and otherwise the most senior, ties going to
// whoever is listed first. Pass only the members who can answer and an
// archived lead falls through to the next in line, as it does there.

export function roomLead<T extends { id: string; seniority?: number }>(
  members: readonly T[],
  leadId?: string | null,
): T | null {
  const chosen = leadId ? members.find((m) => m.id === leadId) : undefined;
  if (chosen) return chosen;
  return members.reduce<T | null>(
    (best, m) => (!best || (m.seniority ?? 1) > (best.seniority ?? 1) ? m : best),
    null,
  );
}
