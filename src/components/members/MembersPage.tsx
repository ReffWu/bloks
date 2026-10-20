// Members: who is in the workspace, who is asking, and how people join
// (designs: Main, Mac-Approve, Mac-Joined).
//
// The page is the owner's and the admins' place to manage people, and a
// member's place to see who is here and what they themselves may spend.
// Requests to join sit at the very top, above everything, because they
// are the one thing on this page somebody is waiting on. Everything else
// is a list that reads like one: a row per person, a row per invite.
//
// It keeps itself current from the server's "workspace." frames, so a
// request arriving, a person let in on another device or an invite used
// all show here without a reload.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, MoreHorizontal, Plus, Search, UserPlus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  activeWords,
  expiresIn,
  initials,
  membersApi,
  ROLE_NAME,
  shortDate,
  tintOf,
  useWorkspaceFrames,
  type AgentAccessRow,
  type Invite,
  type Member,
  type MembersData,
} from "@/lib/members";
import { BlockBurst } from "./BlockBurst";
import { InviteSheet } from "./InviteSheet";
import { AgentAccessDialog, LimitsDialog, PasswordDialog } from "./MemberDialogs";
import { RequestCard } from "./RequestCard";
import { NeedsTeam, UpgradeLink } from "../TeamLock";
import { AlertTriangle } from "@/components/icons";
import { distinctNames } from "@/lib/names";

const DEVICE_WORD = { iphone: "iPhone", mac: "Mac", browser: "Browser" } as const;
/** How long a newcomer's row says "New". */
const NEW_FOR_MS = 60_000;

function Avatar({ id, name, size = 34 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white/90"
      style={{ width: size, height: size, background: tintOf(id), fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

function Section({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex min-h-8 items-center justify-between gap-4 px-0.5">
        <h2 className="text-ui font-semibold text-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-col divide-y overflow-hidden rounded-[14px] border bg-card", className)}>{children}</div>;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [
    copied,
    (key: string, text: string) =>
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(key);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1600);
      }),
  ] as const;
}

export function MembersPage({
  onOpenRoom,
  workspace,
  onCount,
}: {
  onOpenRoom?: () => void;
  /** The workspace as the app lists it, when there is a list: its name and
   * mark are told to the server, which puts them on invites. */
  workspace?: { name: string; kind: string; mark: { color: string; pattern: string } | null };
  /** How many people are in it, the owner included, for the switcher. */
  onCount?: (count: number) => void;
} = {}) {
  const [data, setData] = useState<MembersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [limitsFor, setLimitsFor] = useState<Member | null>(null);
  const [agents, setAgents] = useState<AgentAccessRow[] | null>(null);
  const [accessFor, setAccessFor] = useState<AgentAccessRow | null>(null);
  const [newcomer, setNewcomer] = useState<{ id: string; at: number } | null>(null);
  const [copied, copy] = useCopy();

  const load = useCallback(() => {
    membersApi
      .list()
      .then((next) => {
        setData(next);
        setError(null);
        if (next.invites) membersApi.access().then((a) => setAgents(a.agents)).catch(() => {});
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // The app's name and mark for this workspace are the truth; the server
  // only borrows them for invites, so it is told when they differ.
  useEffect(() => {
    if (!data || data.you.role !== "owner" || !workspace?.mark) return;
    const same = data.workspace.name === workspace.name && data.workspace.mark.color === workspace.mark.color && data.workspace.mark.pattern === workspace.mark.pattern;
    if (same) return;
    void membersApi.setIdentity({ name: workspace.name, kind: workspace.kind, mark: workspace.mark }).then(load).catch(() => {});
  }, [data, workspace, load]);

  const people = data ? data.members.length + 1 : null;
  useEffect(() => {
    if (people !== null) onCount?.(people);
  }, [people, onCount]);

  useWorkspaceFrames(
    useCallback(
      (frame) => {
        if (frame.kind === "workspace.joined") {
          const person = frame.person as { id: string; name: string; role: "member" | "admin" };
          setNewcomer({ id: person.id, at: Date.now() });
          const first = person.name.split(" ")[0] || person.name;
          toast.success(`${first} joined ${String(frame.workspace ?? "the workspace")} as ${person.role === "admin" ? "an Admin" : "a Member"}`, {
            id: `joined-${person.id}`,
            ...(onOpenRoom ? { action: { label: "Say hello in a room", onClick: onOpenRoom } } : {}),
          });
        }
        load();
      },
      [load, onOpenRoom],
    ),
  );

  // the "New" mark and its burst last a minute, then the row is a row
  useEffect(() => {
    if (!newcomer) return;
    const t = setTimeout(() => setNewcomer(null), NEW_FOR_MS);
    return () => clearTimeout(t);
  }, [newcomer]);

  const manage = data ? data.you.role !== "member" : false;
  // people come in on Bloks Team only (server/plan-limits.ts); a server
  // from before that said nothing, and stays as it was
  const teamOn = data?.team !== false;
  const owner = data?.you.role === "owner";
  const members = useMemo(() => {
    const list = data?.members ?? [];
    const q = query.trim().toLowerCase();
    const shown = q ? list.filter((m) => m.name.toLowerCase().includes(q)) : list;
    // somebody just let in leads the list while they are new
    return newcomer ? [...shown].sort((a, b) => (a.id === newcomer.id ? -1 : b.id === newcomer.id ? 1 : 0)) : shown;
  }, [data?.members, query, newcomer]);

  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-44 rounded-[14px]" />
        <Skeleton className="h-28 rounded-[14px]" />
        {error && <p role="alert" className="text-body text-destructive">{error}</p>}
      </div>
    );
  }

  const ws = data.workspace;
  const joining = data.joining;
  const total = data.members.length + 1;
  const invites = data.invites ?? [];
  const requests = data.requests ?? [];
  const ownerMatches = !query.trim() || data.owner.name.toLowerCase().includes(query.trim().toLowerCase());

  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (m: Member) => {
    const yes = await confirm({
      title: `Remove ${m.name} from ${ws.name}?`,
      body: `${m.name} loses every room and agent here at once, and their devices are signed out. Their private conversations and solo agents go with them.\n\nYou can invite them again later.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (yes) await run(() => membersApi.remove(m.id));
  };

  const cancelInvite = async (inv: Invite) => {
    const who = inv.name ? `the invite for ${inv.name}` : "this invite";
    const yes = await confirm({
      title: `Cancel ${who}?`,
      body: "Its code, QR and link stop working at once. Anyone who has them is told it was cancelled.",
      confirmLabel: "Cancel invite",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (yes) await run(() => membersApi.cancel(inv.id));
  };

  const clearPassword = async () => {
    const yes = await confirm({
      title: "Remove the join password?",
      body: "From now on the invite alone is enough to ask to join. People already in are not affected.",
      confirmLabel: "Remove password",
      destructive: true,
    });
    if (yes) await run(() => membersApi.clearPassword());
  };

  return (
    <div className="flex flex-col gap-[26px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-6">
          <h1 className="text-balance text-display font-bold text-foreground">Members</h1>
          {manage && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Button size="lg" onClick={() => setInviting(true)} disabled={!teamOn}>
                <Plus size={16} />
                Invite someone
              </Button>
              {/* while paused, the banner below says it once, with the way */}
              {!teamOn && !data.paused && <NeedsTeam />}
            </div>
          )}
        </div>
        <p className="max-w-[560px] text-pretty text-ui leading-relaxed text-muted-foreground">
          People who can use {ws.name}: its agents, rooms and memory.{" "}
          {joining?.approveEach === false ? "The right code lets people straight in." : "Nobody gets in until you say so."}
        </p>
      </div>

      {/* the owner is not on Bloks Team, and people are in: they are
          paused, said once and plainly, with the way back */}
      {data.paused && manage && (
        <div role="status" className="flex items-start gap-3 rounded-[14px] border border-warning/30 bg-warning/5 px-4 py-3.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-pretty text-ui font-medium text-foreground">Members are paused</span>
            <span className="text-pretty text-body leading-relaxed text-muted-foreground">
              {ws.name} needs Bloks Team for members. Until it is back on Team, nobody here besides you can open it. Nothing is deleted: everyone and everything they had come back with Team.
            </span>
          </div>
          <UpgradeLink className="mt-0.5 shrink-0 text-body" />
        </div>
      )}

      {requests.map((r) => (
        <RequestCard
          key={r.inviteId}
          request={r}
          onApprove={async () => {
            await membersApi.approve(r.inviteId);
            load();
          }}
          onDecline={async () => {
            await membersApi.decline(r.inviteId);
            load();
          }}
        />
      ))}

      <Section
        title={<span className="tabular-nums">{total} {total === 1 ? "member" : "members"}</span>}
        aside={
          total > 4 && (
            <label className="flex h-8 w-60 items-center gap-2 rounded-lg border bg-background px-2.5 text-body text-muted-foreground transition-[border-color] duration-150 focus-within:border-ring/60 max-sm:w-40">
              <Search size={14} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members"
                aria-label="Search members"
                className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          )
        }
      >
        <Card>
          {ownerMatches && (
            <div className="flex items-center gap-3.5 px-[18px] py-3.5">
              <Avatar id="owner" name={data.owner.name} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-ui font-medium text-foreground">
                  {data.owner.name}
                  {owner && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="text-body text-muted-foreground">Owner of {ws.name} · this computer</span>
              </div>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-small font-semibold text-brand-ink">Owner</span>
            </div>
          )}
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              you={m.id === data.you.personId}
              manage={manage}
              isNew={newcomer?.id === m.id}
              mark={ws.mark.color}
              onRole={(role) => void run(() => membersApi.setRole(m.id, role))}
              onLimits={() => setLimitsFor(m)}
              onRemove={() => void remove(m)}
            />
          ))}
          {query && !members.length && !ownerMatches && (
            <p className="px-[18px] py-4 text-body text-muted-foreground">Nobody here is called that.</p>
          )}
        </Card>
        {!manage && <p className="px-0.5 text-pretty text-small text-muted-foreground">{data.privacy.line}</p>}
      </Section>

      {manage && joining && (
        <Section title="Joining">
          <Card>
            <div className="flex items-center gap-4 px-[18px] py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">Join password</span>
                <span className="text-pretty text-body leading-relaxed text-muted-foreground">
                  Asked for after the invite. It is never inside the invite, so share it another way: say it, or text it.
                </span>
              </div>
              {joining.password && <span className="shrink-0 text-body text-muted-foreground">Set {shortDate(joining.password.setAt)}</span>}
              {owner &&
                (joining.password ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">Change</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>Change password</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => void clearPassword()}>
                        Remove password
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
                    Set
                  </Button>
                ))}
            </div>
            <label className="flex items-center gap-4 px-[18px] py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">Approve each person</span>
                <span className="text-pretty text-body text-muted-foreground">
                  {joining.approveEach ? "You check four words with them before they are in." : "The right code and password let people straight in."}
                </span>
              </div>
              <Switch
                checked={joining.approveEach}
                disabled={!owner}
                onCheckedChange={(on) => void run(() => membersApi.setJoining({ approveEach: on }))}
                aria-label="Approve each person"
              />
            </label>
            <label className="flex items-center gap-4 px-[18px] py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-ui font-medium text-foreground">Owner and admins can read members' private conversations</span>
                <span className="text-pretty text-body text-muted-foreground">
                  Off: what a member says to an agent one to one is theirs alone. Members are told which way this is set.
                </span>
              </div>
              <Switch
                checked={joining.privateReadable}
                disabled={!owner}
                onCheckedChange={(on) => void run(() => membersApi.setJoining({ privateReadable: on }))}
                aria-label="Owner and admins can read members' private conversations"
              />
            </label>
          </Card>
        </Section>
      )}

      {manage && agents && data.members.length > 0 && agents.some((a) => !a.solo) && (
        <Section title="Team agents">
          <Card>
            {agents
              .filter((a) => !a.solo)
              .map((a) => (
                <div key={a.id} className="flex items-center gap-3.5 px-[18px] py-3">
                  <span className="flex-1 truncate text-ui text-foreground">{a.name}</span>
                  <span className="shrink-0 text-body text-muted-foreground">{accessWords(a, data.members)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setAccessFor(a)} aria-label={`Who can use ${a.name}`}>
                    Change
                  </Button>
                </div>
              ))}
          </Card>
        </Section>
      )}

      {manage && (
        <Section
          title="Invitations"
          aside={<span className="text-body tabular-nums text-muted-foreground">{invites.length ? `${invites.length} waiting` : "None waiting"}</span>}
        >
          {invites.length ? (
            <Card>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3.5 px-[18px] py-3">
                  <span className="grid size-[34px] shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground" aria-hidden>
                    <UserPlus size={16} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-ui font-medium text-foreground">{inv.name ?? "Anyone with the code"}</span>
                    <span className="text-body text-muted-foreground">
                      {ROLE_NAME[inv.role]} · {expiresIn(inv.expiresAt)}
                      {!inv.online && " · this network only"}
                    </span>
                  </div>
                  <span className="shrink-0 select-all font-mono text-ui font-semibold tracking-[0.06em] text-foreground tabular-nums max-sm:hidden">{inv.code}</span>
                  <Button variant="ghost" size="sm" onClick={() => copy(inv.id, inv.link)} aria-label={`Copy the link for ${inv.name ?? "this invite"}`}>
                    {copied === inv.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    <span aria-live="polite">{copied === inv.id ? "Copied" : "Copy"}</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void cancelInvite(inv)}>
                    Cancel
                  </Button>
                </div>
              ))}
            </Card>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed px-6 py-[22px] text-center">
              <p className="text-pretty text-ui leading-relaxed text-muted-foreground">
                Each invite works once and lasts 24 hours. Invite someone to get a code, a QR and a link.
              </p>
              {teamOn ? (
                <Button variant="secondary" size="sm" onClick={() => setInviting(true)}>
                  Invite someone
                </Button>
              ) : (
                <NeedsTeam />
              )}
            </div>
          )}
          {!data.online.available && <p className="px-0.5 text-pretty text-small text-muted-foreground">{data.online.why}</p>}
        </Section>
      )}

      {manage && (
        <InviteSheet
          open={inviting}
          onOpenChange={setInviting}
          workspace={ws}
          passwordSet={Boolean(joining?.password)}
          approveEach={joining?.approveEach !== false}
          onChanged={load}
        />
      )}
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} changing={Boolean(joining?.password)} onSaved={load} />
      <LimitsDialog member={limitsFor} engines={data.engines ?? []} onOpenChange={(o) => !o && setLimitsFor(null)} onSaved={load} />
      <AgentAccessDialog agent={accessFor} members={data.members} owner={owner} onOpenChange={(o) => !o && setAccessFor(null)} onSaved={load} />
    </div>
  );
}

function accessWords(agent: AgentAccessRow, members: Member[]): string {
  const a = agent.access;
  if (!a || a.mode === "everyone") return "Everyone";
  // first names, told apart where two share one (src/lib/names.ts)
  const called = distinctNames(members);
  const names = a.people.map((id) => called.get(id)).filter(Boolean) as string[];
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  if (a.mode === "only") return names.length ? `Only you and ${list}` : "Only you";
  return names.length ? `Everyone except ${list}` : "Everyone";
}

function MemberRow({
  member: m,
  you,
  manage,
  isNew,
  mark,
  onRole,
  onLimits,
  onRemove,
}: {
  member: Member;
  you: boolean;
  manage: boolean;
  isNew: boolean;
  mark: string;
  onRole: (role: "member" | "admin") => void;
  onLimits: () => void;
  onRemove: () => void;
}) {
  const line = [
    `Joined ${isNew ? "just now" : shortDate(m.joinedAt)}`,
    activeWords(m.lastActive),
    m.device ? DEVICE_WORD[m.device] : null,
  ].filter(Boolean);
  const spend = m.spend && m.limits;
  const usage = spend
    ? [
        m.soloAgents ? `${m.soloAgents} solo ${m.soloAgents === 1 ? "agent" : "agents"}` : null,
        m.limits!.monthlyUsd !== null ? `$${m.spend!.usd.toFixed(2)} of $${m.limits!.monthlyUsd} this month` : m.spend!.usd > 0 ? `$${m.spend!.usd.toFixed(2)} this month` : null,
        m.limits!.aiPercent !== null && m.spend!.aiPercent !== null ? `${m.spend!.aiPercent}% of ${m.limits!.aiPercent}% Bloks AI` : null,
      ].filter(Boolean)
    : [];
  const atLimit = Boolean(spend && m.limits!.monthlyUsd !== null && m.spend!.usd >= m.limits!.monthlyUsd);
  return (
    <div
      className={cn(
        "relative flex items-center gap-3.5 px-[18px] py-3.5 transition-[background-color,box-shadow] duration-500",
        isNew && "bg-[color-mix(in_srgb,var(--mark)_10%,transparent)] shadow-[inset_3px_0_0_var(--mark)]",
      )}
      style={{ ["--mark" as string]: mark }}
    >
      <span className="relative">
        <Avatar id={m.id} name={m.name} />
        {isNew && <BlockBurst color={mark} spread={44} count={12} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-ui font-medium text-foreground">
          <span className="truncate">{m.name}</span>
          {you && <span className="font-normal text-muted-foreground">(you)</span>}
          {isNew && (
            <span className="animate-pop-in rounded-full px-2 py-0.5 text-caption font-semibold" style={{ background: `color-mix(in srgb, ${mark} 18%, transparent)`, color: mark }}>
              New
            </span>
          )}
        </span>
        <span className="truncate text-body text-muted-foreground">{line.join(" · ")}</span>
        {usage.length > 0 && (
          <span className={cn("truncate text-small tabular-nums", atLimit ? "text-destructive" : "text-muted-foreground")}>
            {usage.join(" · ")}
            {atLimit && " · at limit"}
          </span>
        )}
      </div>
      {manage ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-foreground/80" aria-label={`Role for ${m.name}: ${ROLE_NAME[m.role]}`}>
                {ROLE_NAME[m.role]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={m.role} onValueChange={(v) => onRole(v as "member" | "admin")}>
                <DropdownMenuRadioItem value="member">Member</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${m.name}`}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onLimits}>Limits and engines...</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRole(m.role === "admin" ? "member" : "admin")}>
                {m.role === "admin" ? "Make a Member" : "Make an Admin"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                Remove from workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : (
        <span className="shrink-0 px-2.5 text-body text-muted-foreground">{ROLE_NAME[m.role]}</span>
      )}
    </div>
  );
}
