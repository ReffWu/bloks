// Who from the workspace is in a room: everyone, or the people chosen
// (PATCH /api/workspace/rooms/:id/access). Drawn in the room's share
// place, for the owner and admins, whenever the workspace has members.
// People let into this room alone, by its own invite, are listed apart:
// they are its guests, in it whatever is chosen here.
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "@/components/icons";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { membersApi, tintOf, initials, type Member } from "@/lib/members";
import { roomAccessBody, roomAudienceLine } from "@/lib/memberRules";

interface RoomRow {
  id: string;
  name: string;
  audience: "everyone" | "some";
  members: string[];
  guests?: Array<{ id: string; name: string }>;
}

export function RoomAudience({ roomId, className }: { roomId: string; className?: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([membersApi.list(), membersApi.access()])
      .then(([list, access]) => {
        setMembers(list.members);
        setRoom((access.rooms as RoomRow[]).find((r) => r.id === roomId) ?? null);
      })
      .catch(() => setMembers([]));
  }, [roomId]);
  useEffect(load, [load]);

  if (!members?.length || !room) return null;
  const save = async (audience: "everyone" | "some", chosen: string[]) => {
    setSaving(true);
    setError(null);
    // shown at once; the server's answer settles it
    setRoom({ ...room, audience, members: audience === "some" ? chosen : room.members });
    try {
      const said = await api(`/api/workspace/rooms/${roomId}/access`, { method: "PATCH", body: JSON.stringify(roomAccessBody(audience, chosen)) });
      if (said?.room) setRoom(said.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load();
    } finally {
      setSaving(false);
    }
  };
  const chosen = new Set(room.members);
  const guests = room.guests ?? [];
  return (
    <section className={className}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-small font-medium text-muted-foreground">From the workspace</span>
        {saving && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
      </div>
      <Segmented
        aria-label="Who from the workspace is in this room"
        value={room.audience}
        onChange={(audience) => void save(audience, [...chosen])}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "some", label: "Chosen people" },
        ]}
      />
      <p className="mt-2 text-pretty text-small text-muted-foreground">{roomAudienceLine(room.audience, chosen.size, members.length, guests.length)}</p>
      {room.audience === "some" && (
        <div className="mt-2 flex flex-col divide-y overflow-hidden rounded-xl border">
          {members.map((m) => {
            const on = chosen.has(m.id);
            return (
              <label key={m.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-body text-foreground hover:bg-accent/50">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold text-white/90" style={{ background: tintOf(m.id) }}>
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.role === "admin" && <span className="text-small text-muted-foreground">Admin</span>}
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  onChange={() => {
                    const next = new Set(chosen);
                    if (on) next.delete(m.id);
                    else next.add(m.id);
                    void save("some", [...next]);
                  }}
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 place-items-center rounded-[5px] border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                  )}
                >
                  {on && <Check size={11} strokeWidth={2.6} />}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {guests.length > 0 && (
        <p className="mt-2 text-pretty text-small text-muted-foreground">
          Guests of this room: {guests.map((g) => g.name).join(", ")}. They reach this room and nothing else here.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-small text-destructive">{error}</p>}
    </section>
  );
}
