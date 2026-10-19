// Sharing a room with other people.
//
// Everything here is the owner's: who is invited, who is let in, what
// they can see, and when it stops. The person joining sees a four word
// check phrase on their screen and so does this panel; comparing the two
// is what makes letting someone in safe, so the phrase is the biggest
// thing on the card that asks.
import { useCallback, useEffect, useState } from "react";
import { Check } from "@/components/icons";
import { Copy } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { X } from "@/components/icons";
import QRCode from "qrcode";
import { api, useStore, type Blok } from "@/state/store";
import type { RoomPerson, RoomSharing } from "@/state/reducer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

interface PendingInvite {
  id: string;
  role: "collaborator" | "viewer";
  status: "open" | "claimed";
  createdAt: number;
  expiresAt: number;
  invitedBy: string;
  claim?: { name: string; at: number; phrase: string };
}

interface PeopleResponse {
  sharing: RoomSharing | null;
  hostName: string;
  plan: "cloud" | "team" | null;
  limits: { rooms: number | null; members: number } | null;
  people: Array<RoomPerson & { invitedBy: string; via?: ChatPlatform }>;
  invites: PendingInvite[];
  knocks: Array<{ id: string; name: string; platform: ChatPlatform; at: number }>;
  chat: {
    link: { platform: ChatPlatform; channelId: string; channelName: string } | null;
    connected: ChatPlatform[];
  };
  spend: { month: string; total: number; cap: number; byPerson: Array<{ id: string; name: string; usd: number }> } | null;
  available: {
    connectors: boolean;
    mcp: Array<{ id: string; name: string }>;
    computer: boolean;
    agents: Array<{ id: string; name: string; ownerTools: boolean }>;
  };
}

const CAPS = [5, 10, 25, 50, 100, 250];

/** The caps to slide between, smallest first and No cap at the far end,
 * keeping a cap set some other way so the slider can still show it. */
function capStops(current: number) {
  const caps = [...new Set([...CAPS, current])].filter((c) => c > 0).sort((a, b) => a - b);
  return [...caps.map((c) => ({ value: c, label: `$${c}` })), { value: 0, label: "No cap" }];
}

type ChatPlatform = "slack" | "discord" | "whatsapp";
const PLATFORM: Record<ChatPlatform, string> = { slack: "Slack", discord: "Discord", whatsapp: "WhatsApp" };

function usd(n: number) {
  return `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
}

export function SharePanel({ blok, open, onOpenChange }: { blok: Blok; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useStore();
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"collaborator" | "viewer">("collaborator");
  const [link, setLink] = useState<{ url: string; qr: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const load = useCallback(() => {
    api(`/api/bloks/${blok.id}/people`)
      .then((next: PeopleResponse) => {
        setData(next);
        setName((current) => current || (next.hostName === "The owner" ? "" : next.hostName));
        // the badge on the header counts what is actually waiting
        dispatch({
          type: "joinRequest",
          roomId: blok.id,
          pending: next.invites.filter((i) => i.claim).length + next.knocks.length,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [blok.id, dispatch]);

  // Reload whenever something about the room's people changes: a request
  // at the door, someone let in, someone leaving.
  const people = state.roomPeople[blok.id];
  const knocking = state.joinRequests[blok.id];
  useEffect(() => {
    if (open) load();
  }, [open, load, people, knocking, blok.sharing]);

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await run();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const share = (patch: Partial<RoomSharing> & { hostName?: string }) =>
    act("share", () => api(`/api/bloks/${blok.id}/share`, { method: "POST", body: JSON.stringify(patch) }));

  const invite = () =>
    act("invite", async () => {
      const made = await api(`/api/bloks/${blok.id}/invites`, { method: "POST", body: JSON.stringify({ role }) });
      const qr = await QRCode.toDataURL(made.link, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 168,
        color: { dark: "#111111", light: "#ffffff" },
      }).catch(() => null);
      setLink({ url: made.link, qr });
      setCopied(false);
    });

  const copy = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const shared = data?.sharing ?? blok.sharing ?? null;
  const waiting = data?.invites.filter((i) => i.claim) ?? [];
  const unopened = data?.invites.filter((i) => !i.claim) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-[480px] overflow-y-auto">
        <DialogTitle className="text-lead font-semibold">Share {blok.name}</DialogTitle>
        <DialogDescription className="mt-1 text-body leading-relaxed text-muted-foreground">
          Invite people to talk to this room's agents. Agents run on this computer, and anything that
          touches your accounts, files or computer waits for you.
        </DialogDescription>

        {error && (
          <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>
        )}

        {!data ? (
          <div className="mt-6 flex justify-center text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : !data.plan ? (
          <div className="mt-4 rounded-2xl border bg-card p-4 text-body leading-relaxed text-muted-foreground">
            Sharing a room needs Bloks Cloud. Turn it on in Settings, under Bloks Cloud.
          </div>
        ) : !shared ? (
          <div className="mt-4 space-y-3">
            <label className="block text-body font-medium text-foreground">
              Your name in the room
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Your name"
                className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-ui outline-none focus:border-foreground/30"
              />
            </label>
            <PlanLine data={data} />
            <Button
              className="w-full"
              disabled={!name.trim() || busy === "share"}
              onClick={() => share({ hostName: name.trim() })}
            >
              {busy === "share" && <Loader2 size={14} className="animate-spin" />}
              Start sharing
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* who is at the door */}
            {waiting.map((inv) => (
              <div key={inv.id} className="rounded-2xl border border-brand-ink/30 bg-brand-ink/5 p-4">
                <div className="text-ui font-medium text-foreground">
                  {inv.claim!.name} wants to join as a {inv.role}
                </div>
                <div className="mt-1 text-small text-muted-foreground">
                  Check these words match what {inv.claim!.name} sees on their screen:
                </div>
                <div className="mt-2 rounded-xl bg-background px-3 py-2.5 text-center font-mono text-title tracking-wide text-foreground">
                  {inv.claim!.phrase}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy !== null}
                    onClick={() => act(`in-${inv.id}`, () => api(`/api/invites/${inv.id}/approve`, { method: "POST" }))}
                  >
                    {busy === `in-${inv.id}` && <Loader2 size={14} className="animate-spin" />}
                    Let in
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => act(`out-${inv.id}`, () => api(`/api/invites/${inv.id}/decline`, { method: "POST" }))}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}

            {/* who is asking from a linked channel */}
            {data.knocks.map((k) => (
              <div key={k.id} className="rounded-2xl border border-brand-ink/30 bg-brand-ink/5 p-4">
                <div className="text-ui font-medium text-foreground">
                  {k.name} wants to talk to the agents from {PLATFORM[k.platform]}
                </div>
                <div className="mt-1 text-small text-muted-foreground">
                  They named an agent in {data.chat.link?.channelName ?? "the linked channel"}. Agents only answer
                  them once you let them in.
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy !== null}
                    onClick={() => act(`kin-${k.id}`, () => api(`/api/knocks/${k.id}/approve`, { method: "POST" }))}
                  >
                    {busy === `kin-${k.id}` && <Loader2 size={14} className="animate-spin" />}
                    Let in
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => act(`kout-${k.id}`, () => api(`/api/knocks/${k.id}/decline`, { method: "POST" }))}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}

            {/* inviting */}
            <section>
              <SectionTitle>Invite someone</SectionTitle>
              <div className="flex gap-2">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "collaborator" | "viewer")}
                  className="rounded-lg border bg-background px-2 text-body"
                  aria-label="Their role"
                >
                  <option value="collaborator">Collaborator: can talk and answer</option>
                  <option value="viewer">Viewer: can read</option>
                </select>
                <Button className="flex-1" disabled={busy === "invite"} onClick={invite}>
                  {busy === "invite" && <Loader2 size={14} className="animate-spin" />}
                  Make an invite link
                </Button>
              </div>
              {link && (
                <div className="mt-3 flex gap-3 rounded-2xl border bg-card p-3">
                  {link.qr && (
                    <div className="shrink-0 rounded-xl bg-white p-1.5">
                      <img src={link.qr} alt="Invite QR code" className="size-[112px]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-small leading-relaxed text-muted-foreground">
                    For one person. Works once, for 24 hours. You still approve who gets in.
                    <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={copy}>
                      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                </div>
              )}
              {unopened.length > 0 && (
                <div className="mt-2 space-y-1">
                  {unopened.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-small text-muted-foreground">
                      <span>
                        Invite for a {inv.role}, not opened yet
                        {inv.invitedBy !== data.hostName ? ` (from ${inv.invitedBy})` : ""}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Cancel this invite"
                        onClick={() => act(`x-${inv.id}`, () => api(`/api/invites/${inv.id}`, { method: "DELETE" }))}
                      >
                        <X size={13} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <PlanLine data={data} />
            </section>

            {/* who is in */}
            <section>
              <SectionTitle>In this room</SectionTitle>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-body">
                  <span className="text-foreground">{data.hostName} (you)</span>
                  <span className="text-small text-muted-foreground">Owner</span>
                </div>
                {data.people.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-body">
                    <span className="min-w-0 truncate text-foreground">
                      {p.name}
                      {p.via && <span className="ml-1.5 text-small text-muted-foreground">in {PLATFORM[p.via]}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <select
                        value={p.role}
                        onChange={(e) =>
                          act(`role-${p.id}`, () =>
                            api(`/api/bloks/${blok.id}/people/${p.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ role: e.target.value }),
                            }),
                          )
                        }
                        className="rounded-md border bg-background px-1.5 py-0.5 text-small"
                        aria-label={`${p.name}'s role`}
                      >
                        <option value="collaborator">Collaborator</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={`Remove ${p.name}`}
                        onClick={() =>
                          act(`rm-${p.id}`, () => api(`/api/bloks/${blok.id}/people/${p.id}`, { method: "DELETE" }))
                        }
                      >
                        <X size={13} />
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* how the room behaves */}
            <section>
              <SectionTitle>Room settings</SectionTitle>
              <div className="space-y-3">
                <Toggle
                  label="New people see the whole history"
                  hint="Off: only from when they joined. Applies to everyone in the room."
                  checked={shared.history === "all"}
                  onChange={(on) => share({ history: on ? "all" : "join" })}
                />
                <Toggle
                  label="Collaborators can invite"
                  hint="They can make invite links. You still let every person in."
                  checked={shared.collaboratorsInvite}
                  onChange={(on) => share({ collaboratorsInvite: on })}
                />
                <Toggle
                  label="Show what agents' tools did"
                  hint="Off: people see that an agent searched or read a file, not what."
                  checked={shared.activityDetail}
                  onChange={(on) => share({ activityDetail: on })}
                />
                <Toggle
                  label="Agents can work with files in this room's folder"
                  hint="Off: agents in this room can only talk. Your own files stay out either way."
                  checked={shared.tools === "desk"}
                  onChange={(on) => share({ tools: on ? "desk" : "conversation" })}
                />
              </div>
            </section>

            <ChatLinkSection blokId={blok.id} data={data} act={act} busy={busy !== null} />

            <OwnerToolsSection data={data} shared={shared} busy={busy !== null} share={share} />

            {/* what it costs */}
            <section>
              <SectionTitle>Spending</SectionTitle>
              <div className="text-body text-foreground">Monthly cap for this room</div>
              <div className="text-small leading-snug text-muted-foreground">
                Agents here use your engines. At the cap, they pause until next month or until you raise it.
              </div>
              <Slider
                aria-label="Monthly cap"
                className="mt-3"
                stops={capStops(shared.spendCap ?? 0)}
                value={shared.spendCap ?? 0}
                onCommit={(spendCap) => share({ spendCap })}
              />
              {data.spend && (
                <div className="mt-3 rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex items-baseline justify-between text-body">
                    <span className="text-muted-foreground">This month</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {usd(data.spend.total)}
                      {data.spend.cap > 0 && <span className="text-muted-foreground"> of ${data.spend.cap}</span>}
                    </span>
                  </div>
                  {data.spend.cap > 0 && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${data.spend.total >= data.spend.cap ? "bg-destructive" : "bg-brand-ink"}`}
                        style={{ width: `${Math.min(100, (data.spend.total / data.spend.cap) * 100)}%` }}
                      />
                    </div>
                  )}
                  {data.spend.byPerson.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {data.spend.byPerson.map((p) => (
                        <div key={p.id} className="flex justify-between text-small text-muted-foreground">
                          <span className="truncate">{p.id === "owner" ? `${p.name} (you)` : p.name}</span>
                          <span className="tabular-nums">{usd(p.usd)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 text-caption leading-snug text-muted-foreground">
                    Estimated, by who asked.
                  </div>
                </div>
              )}
            </section>

            <section className="border-t pt-4">
              {confirmStop ? (
                <div className="space-y-2">
                  <div className="text-body text-muted-foreground">
                    Everyone leaves the room and their access ends now. The conversation stays with you.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={busy === "stop"}
                      onClick={() =>
                        act("stop", async () => {
                          await api(`/api/bloks/${blok.id}/share`, { method: "DELETE" });
                          setConfirmStop(false);
                          setLink(null);
                        })
                      }
                    >
                      Stop sharing
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmStop(false)}>
                      Keep sharing
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmStop(true)}>
                  Stop sharing this room
                </Button>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Carrying this room into a Slack or Discord channel. The channel list is
 * fetched only when asked for, since it is a call out to the platform.
 */
function ChatLinkSection({
  blokId,
  data,
  act,
  busy,
}: {
  blokId: string;
  data: PeopleResponse;
  act: (key: string, run: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [platform, setPlatform] = useState<ChatPlatform | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const link = data.chat.link;

  const pick = (next: ChatPlatform) => {
    setPlatform(next);
    setChannels(null);
    setChannelId("");
    setError(null);
    api(`/api/chat/${next}/channels`)
      .then((r: { channels: Array<{ id: string; name: string }> }) => setChannels(r.channels))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <section>
      <SectionTitle>Chat channel</SectionTitle>
      {link ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-body text-foreground">
            Linked to <span className="font-medium">{link.channelName}</span> in {PLATFORM[link.platform]}
            <div className="text-small leading-snug text-muted-foreground">
              Messages show in both places. People there name an agent to talk to it, once you let them in.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => act("unlink", () => api(`/api/bloks/${blokId}/chat`, { method: "DELETE" }))}
          >
            Unlink
          </Button>
        </div>
      ) : data.chat.connected.length === 0 ? (
        <div className="text-small leading-snug text-muted-foreground">
          Bring this room into Slack or Discord. Connect one in Settings, under Chat and email.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-small leading-snug text-muted-foreground">
            Bring this room into a channel. Agents only answer people you let in, when they name an agent.
          </div>
          <div className="flex flex-wrap gap-2">
            {data.chat.connected.map((p) => (
              <Button key={p} size="sm" variant={platform === p ? "default" : "secondary"} onClick={() => pick(p)}>
                {PLATFORM[p]}
              </Button>
            ))}
          </div>
          {platform && channels === null && !error && (
            <div className="text-small text-muted-foreground">
              <Loader2 size={12} className="mr-1 inline animate-spin" />
              Finding channels
            </div>
          )}
          {platform && channels && (
            channels.length === 0 ? (
              <div className="text-small leading-snug text-muted-foreground">
                {platform === "whatsapp"
                  ? "The number isn't in any groups yet. Add it to one in WhatsApp, then pick again."
                  : `The bot isn't in any channels yet. Add it to one in ${PLATFORM[platform]}, then pick again.`}
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border bg-background px-2 text-body"
                  aria-label="Channel"
                >
                  <option value="">Pick a channel</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!channelId || busy}
                  onClick={() =>
                    act("link", () =>
                      api(`/api/bloks/${blokId}/chat`, {
                        method: "POST",
                        body: JSON.stringify({
                          platform,
                          channelId,
                          channelName: channels.find((c) => c.id === channelId)?.name ?? channelId,
                        }),
                      }),
                    )
                  }
                >
                  Link
                </Button>
              </div>
            )
          )}
          {error && <div className="text-small text-warning">{error}</div>}
        </div>
      )}
    </section>
  );
}

/**
 * Opening some of the owner's own tools to a shared room. Team only, and
 * each one by name. The panel says plainly that every use still waits for
 * an approval, and which agents cannot take part.
 */
function OwnerToolsSection({
  data,
  shared,
  busy,
  share,
}: {
  data: PeopleResponse;
  shared: RoomSharing;
  busy: boolean;
  share: (patch: Partial<RoomSharing>) => void;
}) {
  const team = data.plan === "team";
  const tools = shared.ownerTools ?? {};
  const set = (patch: Partial<NonNullable<RoomSharing["ownerTools"]>>) =>
    share({ ownerTools: { connectors: false, browser: false, computer: false, mcp: [], ...tools, ...patch } });
  const left = data.available.agents.filter((a) => !a.ownerTools);
  const anyOn = Boolean(tools.connectors || tools.browser || tools.computer || tools.mcp?.length);

  return (
    <section>
      <SectionTitle>Your tools</SectionTitle>
      {!team ? (
        <div className="text-small leading-snug text-muted-foreground">
          With Bloks Team, agents here can ask to use your apps, a browser or your computer. You approve
          each use.{" "}
          <a
            href="https://bloks.dev/cloud/upgrade/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Move to Team
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-small leading-snug text-muted-foreground">
            Agents here can ask to use what you turn on. You approve every use, whatever your rules say.
          </div>
          {data.available.connectors && (
            <Toggle
              label="Connected apps"
              hint="Email, calendar and other connected apps."
              checked={Boolean(tools.connectors)}
              disabled={busy}
              onChange={(on) => set({ connectors: on })}
            />
          )}
          {data.available.mcp.map((server) => (
            <Toggle
              key={server.id}
              label={server.name}
              hint="An MCP server, for agents that have it."
              checked={Boolean(tools.mcp?.includes(server.id))}
              disabled={busy}
              onChange={(on) =>
                set({
                  mcp: on
                    ? [...new Set([...(tools.mcp ?? []), server.id])]
                    : (tools.mcp ?? []).filter((id) => id !== server.id),
                })
              }
            />
          ))}
          <Toggle
            label="A browser"
            hint="A separate browser, not signed in to your accounts."
            checked={Boolean(tools.browser)}
            disabled={busy}
            onChange={(on) => set({ browser: on })}
          />
          {data.available.computer && (
            <Toggle
              label="Your computer"
              hint="The computer your agents use. You approve every action."
              checked={Boolean(tools.computer)}
              disabled={busy}
              onChange={(on) => set({ computer: on })}
            />
          )}
          <Toggle
            label="Collaborators can approve"
            hint="They can approve requests, except their own."
            checked={Boolean(shared.collaboratorsApprove)}
            disabled={busy}
            onChange={(on) => share({ collaboratorsApprove: on })}
          />
          {anyOn && left.length > 0 && (
            <div className="text-small leading-snug text-muted-foreground">
              {left.map((a) => a.name).join(", ")} can't pause for approvals, so{" "}
              {left.length === 1 ? "it" : "they"} can only talk.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-small font-medium text-muted-foreground">{children}</div>;
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-body text-foreground">{label}</div>
        <div className="text-small leading-snug text-muted-foreground">{hint}</div>
      </div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** What the plan allows, said once and plainly. */
function PlanLine({ data }: { data: PeopleResponse }) {
  if (data.plan !== "cloud" || !data.limits) return null;
  return (
    <div className="mt-2 text-small leading-snug text-muted-foreground">
      Bloks Cloud includes one shared room for up to {data.limits.members} people. Bloks Team allows any
      number of rooms, up to 10 people each.{" "}
      <a
        href="https://bloks.dev/cloud/upgrade/"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline underline-offset-2"
      >
        Move to Team
      </a>
    </div>
  );
}
