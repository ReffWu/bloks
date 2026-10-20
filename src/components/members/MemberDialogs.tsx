// The small decisions on the Members page, each in its own dialog: the
// join password, one member's limits, and who shares an agent's team
// conversation. Each is one thing to decide, says what it means in a line,
// and saves with one button; errors appear where the decision is made.
import { useEffect, useState } from "react";
import { Eye, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { initials, membersApi, tintOf, type AgentAccessRow, type Member, type MemberLimit } from "@/lib/members";

function Footer({ busy, onCancel, label, disabled }: { busy: boolean; onCancel: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy || disabled}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

/** Sets or changes the join password. Shown twice-typed nowhere: one
 * field, with a way to see it, since the owner will read it out anyway. */
export function PasswordDialog({ open, onOpenChange, changing, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; changing: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue("");
      setShown(false);
      setError(null);
    }
  }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await membersApi.setPassword(value);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[420px]">
        <form onSubmit={(e) => void save(e)}>
          <DialogTitle>{changing ? "Change the join password" : "Set a join password"}</DialogTitle>
          <DialogDescription>
            Asked for after the invite, and never inside it, so share it another way: say it, or text it. People already in are not affected.
          </DialogDescription>
          <label className="mt-4 flex flex-col gap-1.5 text-small text-muted-foreground">
            Join password
            <div className="relative">
              <Input
                autoFocus
                type={shown ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
                className={cn("pr-10", error && "border-destructive")}
              />
              <button
                type="button"
                aria-label={shown ? "Hide the password" : "Show the password"}
                aria-pressed={shown}
                onClick={() => setShown((s) => !s)}
                className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              >
                <Eye size={15} />
              </button>
            </div>
          </label>
          <p className={cn("mt-1.5 text-small", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
            {error ?? "At least 4 characters. Something easy to say out loud works well."}
          </p>
          <Footer busy={busy} onCancel={() => onOpenChange(false)} label={changing ? "Change password" : "Set password"} disabled={value.trim().length < 4} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One member's limits: what they may spend, how many solo agents they
 * may make, and on which engines. Applies to them alone. */
export function LimitsDialog({
  member,
  engines,
  onOpenChange,
  onSaved,
}: {
  member: Member | null;
  engines: Array<{ id: string; name: string }>;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const limits: MemberLimit = member?.limits ?? { monthlyUsd: null, aiPercent: null, maxSolo: 3, engines: null };
  const [usd, setUsd] = useState("");
  const [ai, setAi] = useState("");
  const [solo, setSolo] = useState("3");
  const [anyEngine, setAnyEngine] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!member) return;
    setUsd(limits.monthlyUsd === null ? "" : String(limits.monthlyUsd));
    setAi(limits.aiPercent === null ? "" : String(limits.aiPercent));
    setSolo(String(limits.maxSolo));
    setAnyEngine(limits.engines === null);
    setPicked(limits.engines ?? engines.map((e) => e.id));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await membersApi.setLimits(member.id, {
        monthlyUsd: usd.trim() === "" ? null : Number(usd),
        aiPercent: ai.trim() === "" ? null : Number(ai),
        maxSolo: Number(solo),
        engines: anyEngine ? null : picked,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const first = member?.name.split(" ")[0] ?? "";
  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[460px]">
        <form onSubmit={(e) => void save(e)}>
          <DialogTitle>Limits for {member?.name}</DialogTitle>
          <DialogDescription>
            What {first} starts runs on your engines and keys. At a limit, {first}'s own requests stop with a clear message; nobody else is affected.
          </DialogDescription>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-small text-muted-foreground">
              Monthly API spending
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ui text-muted-foreground">$</span>
                <Input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="No limit" className="pl-6 tabular-nums" />
              </div>
            </label>
            <label className="flex flex-col gap-1.5 text-small text-muted-foreground">
              Bloks AI share a month
              <div className="relative">
                <Input inputMode="decimal" value={ai} onChange={(e) => setAi(e.target.value)} placeholder="No limit" className="pr-7 tabular-nums" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui text-muted-foreground">%</span>
              </div>
            </label>
            <label className="col-span-2 flex flex-col gap-1.5 text-small text-muted-foreground">
              Solo agents {first} may make
              <Input inputMode="numeric" value={solo} onChange={(e) => setSolo(e.target.value)} className="w-24 tabular-nums" />
            </label>
          </div>
          <div className="mt-4 rounded-xl border">
            <label className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex-1 text-ui text-foreground">Any engine for solo agents</span>
              <Switch checked={anyEngine} onCheckedChange={setAnyEngine} aria-label="Any engine for solo agents" />
            </label>
            {!anyEngine && (
              <div className="flex flex-col gap-1 border-t px-3.5 py-2.5">
                {engines.map((engine) => (
                  <label key={engine.id} className="flex items-center gap-2.5 py-1 text-ui text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--brand)]"
                      checked={picked.includes(engine.id)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, engine.id] : p.filter((x) => x !== engine.id)))}
                    />
                    {engine.name}
                  </label>
                ))}
                {!engines.length && <span className="py-1 text-body text-muted-foreground">No engines are set up yet.</span>}
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-body text-destructive">
              {error}
            </p>
          )}
          {member?.spend && (
            <p className="mt-3 text-small tabular-nums text-muted-foreground">
              This month so far: ${member.spend.usd.toFixed(2)} on API keys{member.spend.aiPercent !== null ? `, ${member.spend.aiPercent}% of Bloks AI` : ""}.
            </p>
          )}
          <Footer busy={busy} onCancel={() => onOpenChange(false)} label="Save limits" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who shares one team agent's own conversation. Rooms are separate: a
 * person left out here still meets the agent in a room they are in. */
export function AgentAccessDialog({
  agent,
  members,
  owner,
  onOpenChange,
  onSaved,
}: {
  agent: AgentAccessRow | null;
  members: Member[];
  owner: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"everyone" | "only" | "except">("everyone");
  const [people, setPeople] = useState<string[]>([]);
  const [admins, setAdmins] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!agent?.access) return;
    setMode(agent.access.mode);
    setPeople(agent.access.people);
    setAdmins(agent.access.admins);
    setError(null);
  }, [agent?.id, agent?.access]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await membersApi.setAgentAccess(agent.id, { mode, people, ...(owner ? { admins } : {}) });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(agent)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[460px]">
        <form onSubmit={(e) => void save(e)}>
          <DialogTitle>Who can use {agent?.name}</DialogTitle>
          <DialogDescription>
            The people in {agent?.name}'s team conversation. Anyone in a room with {agent?.name} can still talk to it there, and have a private conversation with it.
          </DialogDescription>
          <Segmented
            aria-label="Who can use this agent"
            className="mt-4"
            value={mode}
            onChange={setMode}
            options={[
              { value: "everyone", label: "Everyone" },
              { value: "only", label: "Only these people" },
              { value: "except", label: "Everyone except" },
            ]}
          />
          {mode !== "everyone" && (
            <div className="mt-3 flex max-h-[240px] flex-col overflow-y-auto rounded-xl border">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-3 border-b px-3.5 py-2.5 last:border-b-0">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-caption font-semibold text-white/90" style={{ background: tintOf(m.id) }} aria-hidden>
                    {initials(m.name)}
                  </span>
                  <span className="flex-1 truncate text-ui text-foreground">{m.name}</span>
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={people.includes(m.id)}
                    onChange={(e) => setPeople((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))}
                    aria-label={`${mode === "only" ? "Include" : "Leave out"} ${m.name}`}
                  />
                </label>
              ))}
              {!members.length && <span className="px-3.5 py-3 text-body text-muted-foreground">Nobody else is in the workspace yet.</span>}
            </div>
          )}
          {owner && (
            <label className="mt-3 flex items-center gap-3 rounded-xl border px-3.5 py-3">
              <span className="flex-1 text-ui text-foreground">Admins always have access</span>
              <Switch checked={admins} onCheckedChange={setAdmins} aria-label="Admins always have access" />
            </label>
          )}
          {error && (
            <p role="alert" className="mt-3 text-body text-destructive">
              {error}
            </p>
          )}
          <Footer busy={busy} onCancel={() => onOpenChange(false)} label="Save" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
