// "Who can use this agent", in an agent's own settings: the same list the
// Members page edits, at the place somebody looks when they are thinking
// about this one agent. Only shown when the workspace has other people in
// it, and never for a solo agent, which is its maker's alone.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { membersApi, useWorkspaceFrames, type AgentAccessRow, type Member } from "@/lib/members";
import { AgentAccessDialog } from "./MemberDialogs";
import { distinctNames } from "@/lib/names";
import { t } from "@/lib/i18n";

export function AgentAccessCard({ botId }: { botId: string }) {
  const [agent, setAgent] = useState<AgentAccessRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    Promise.all([membersApi.list(), membersApi.access()])
      .then(([list, access]) => {
        setMembers(list.members);
        setOwner(list.you.role === "owner");
        setAgent(access.agents.find((a) => a.id === botId && !a.solo) ?? null);
      })
      .catch(() => setAgent(null));
  }, [botId]);
  useEffect(load, [load]);
  useWorkspaceFrames(useCallback(() => load(), [load]));

  if (!agent || !members.length) return null;
  const a = agent.access;
  // first names, told apart where two share one (src/lib/names.ts)
  const called = distinctNames(members);
  const names = (ids: string[]) => ids.map((id) => called.get(id)).filter(Boolean).join(", ");
  const summary = !a || a.mode === "everyone" ? "Everyone in the workspace" : a.mode === "only" ? `Only you${a.people.length ? `, ${names(a.people)}` : ""}${a.admins ? " and admins" : ""}` : `Everyone except ${names(a.people) || "nobody"}`;
  return (
    <div className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-6 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-ui font-medium text-foreground">{t("agentAccessCard.whoCanUseThisAgent")}</div>
          <div className="mt-0.5 text-pretty text-body leading-relaxed text-muted-foreground">
            {summary}. Anyone in a room with {agent.name} can still talk to it there.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {t("common.change")}
        </Button>
      </div>
      <AgentAccessDialog agent={editing ? agent : null} members={members} owner={owner} onOpenChange={(o) => !o && setEditing(false)} onSaved={load} />
    </div>
  );
}
