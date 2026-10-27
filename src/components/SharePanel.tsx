// Sharing a room with other people.
//
// Everything here is the owner's: who is invited, who is let in, what
// they can see, and when it stops. The person joining sees a four word
// check phrase on their screen and so does this panel; comparing the two
// is what makes letting someone in safe, so the phrase is the biggest
// thing on the card that asks.
import { NeedsTeam, UpgradeLink } from "./TeamLock";
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
import { RoomAudience } from "./members/RoomAudience";
import { useWorkspaceFrames } from "@/lib/members";
import { askYourName } from "./YourNameDialog";
import { needsName, readYourName } from "@/lib/yourName";
import { formatList, formatNumber, t, tr } from "@/lib/i18n";

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
  /** Whether this licence lets a room take new guests: Team, or a Cloud
   * licence from before sharing rooms became Team's. Absent from an
   * older server, which shares as it always did. */
  sharedRoom?: boolean;
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
  return [...caps.map((c) => ({ value: c, label: dollars(c) })), { value: 0, label: t("sharePanel.noCap") }];
}

type ChatPlatform = "slack" | "discord" | "whatsapp" | "signal";
const PLATFORM: Record<ChatPlatform, string> = { slack: "Slack", discord: "Discord", whatsapp: "WhatsApp", signal: "Signal" };

function usd(n: number) {
  const digits = n < 10 ? 2 : 0;
  return formatNumber(n, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A cap in dollars, whole unless it was set with cents. */
function dollars(n: number) {
  return formatNumber(n, { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Agent names one after another, the reader's way. */
const listed = (names: string[]) => formatList(names, { type: "unit", style: "short" });

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
        // no name yet: the one this computer's account carries, to keep or
        // change, so sharing is one press for most people
        if (next.hostName === "The owner" && !next.sharing) {
          void readYourName().then(({ suggested }) => suggested && setName((current) => current || suggested));
        }
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
  // and when the plan changes (somebody back from bloks.dev on Team now),
  // so the door opens without closing the panel first
  useWorkspaceFrames(
    useCallback(
      (frame) => {
        if (open && frame.kind === "workspace.plan") load();
      },
      [open, load],
    ),
  );

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
      const ask = () => api(`/api/bloks/${blok.id}/invites`, { method: "POST", body: JSON.stringify({ role }) });
      // a room shared before Bloks asked names: asked now, then on with it
      const made = await ask().catch(async (e) => {
        if (!needsName(e)) throw e;
        if (!(await askYourName({ why: t("sharePanel.nameWhy", { room: blok.name }) }))) return null;
        return ask();
      });
      if (!made) return;
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
        <DialogTitle className="text-lead font-semibold">{t("sharePanel.title", { room: blok.name })}</DialogTitle>
        <DialogDescription className="mt-1 text-body leading-relaxed text-muted-foreground">
          {t("sharePanel.invitePeopleToTalkTo")}
        </DialogDescription>

        {error && (
          <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-body text-destructive">{error}</div>
        )}

        {/* who from the workspace: the room's audience, whatever its sharing */}
        <RoomAudience roomId={blok.id} className="mt-4" />

        {!data ? (
          <div className="mt-6 flex justify-center text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : !data.plan ? (
          <div className="mt-4 rounded-2xl border bg-card p-4 text-body leading-relaxed text-muted-foreground">
            {t("sharePanel.invitingSomeoneToThisRoom")}
          </div>
        ) : data.sharedRoom === false && !shared ? (
          // a Cloud licence from after sharing rooms became Team's
          <div className="mt-4 flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <span className="text-ui font-medium text-foreground">{t("sharePanel.sharingRoomsNeedsBloksTeam")}</span>
            <span className="text-pretty text-body leading-relaxed text-muted-foreground">
              {t("sharePanel.bloksTeamLetsPeopleInto")}
            </span>
            <UpgradeLink className="self-start text-body" />
          </div>
        ) : !shared ? (
          <div className="mt-4 space-y-3">
            <label className="block text-body font-medium text-foreground">
              {t("sharePanel.yourName")}
              <span className="mt-0.5 block text-small font-normal text-muted-foreground">
                {t("sharePanel.everyoneYouLetInSees")}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder={t("common.yourName")}
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
              {t("sharePanel.startSharing")}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {/* who is at the door */}
            {waiting.map((inv) => (
              <div key={inv.id} className="rounded-2xl border border-brand-ink/30 bg-brand-ink/5 p-4">
                <div className="text-ui font-medium text-foreground">
                  {inv.role === "viewer"
                    ? t("sharePanel.wantsToJoin.viewer", { name: inv.claim!.name })
                    : t("sharePanel.wantsToJoin.collaborator", { name: inv.claim!.name })}
                </div>
                <div className="mt-1 text-small text-muted-foreground">
                  {t("sharePanel.checkWords", { name: inv.claim!.name })}
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
                    {t("sharePanel.letIn")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => act(`out-${inv.id}`, () => api(`/api/invites/${inv.id}/decline`, { method: "POST" }))}
                  >
                    {t("common.decline")}
                  </Button>
                </div>
              </div>
            ))}

            {/* who is asking from a linked channel */}
            {data.knocks.map((k) => (
              <div key={k.id} className="rounded-2xl border border-brand-ink/30 bg-brand-ink/5 p-4">
                <div className="text-ui font-medium text-foreground">
                  {t("sharePanel.knock.title", { name: k.name, platform: PLATFORM[k.platform] })}
                </div>
                <div className="mt-1 text-small text-muted-foreground">
                  {data.chat.link?.channelName
                    ? t("sharePanel.knock.named", { channel: data.chat.link.channelName })
                    : t("sharePanel.knock.namedLinked")}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy !== null}
                    onClick={() => act(`kin-${k.id}`, () => api(`/api/knocks/${k.id}/approve`, { method: "POST" }))}
                  >
                    {busy === `kin-${k.id}` && <Loader2 size={14} className="animate-spin" />}
                    {t("sharePanel.letIn")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => act(`kout-${k.id}`, () => api(`/api/knocks/${k.id}/decline`, { method: "POST" }))}
                  >
                    {t("common.decline")}
                  </Button>
                </div>
              </div>
            ))}

            {/* inviting: a room shared before keeps its guests, and only
                Team, or a licence that holds a shared room, lets more in */}
            <section>
              <SectionTitle>{t("sharePanel.inviteSomeone")}</SectionTitle>
              {data.sharedRoom === false ? (
                <NeedsTeam what={t("sharePanel.sharingRoomsNeedsBloksTeam")} />
              ) : (
              <div className="flex gap-2">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "collaborator" | "viewer")}
                  className="rounded-lg border bg-background px-2 text-body"
                  aria-label={t("sharePanel.theirRole")}
                >
                  <option value="collaborator">{t("sharePanel.collaboratorCanTalkAndAnswer")}</option>
                  <option value="viewer">{t("sharePanel.viewerCanRead")}</option>
                </select>
                <Button className="flex-1" disabled={busy === "invite"} onClick={invite}>
                  {busy === "invite" && <Loader2 size={14} className="animate-spin" />}
                  {t("sharePanel.makeAnInviteLink")}
                </Button>
              </div>
              )}
              {link && (
                <div className="mt-3 flex gap-3 rounded-2xl border bg-card p-3">
                  {link.qr && (
                    <div className="shrink-0 rounded-xl bg-white p-1.5">
                      <img src={link.qr} alt={t("sharePanel.inviteQrCode")} className="size-[112px]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-small leading-relaxed text-muted-foreground">
                    {t("sharePanel.inviteWorksOnce")}
                    <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={copy}>
                      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                      {copied ? t("common.copied") : t("sharePanel.copyLink")}
                    </Button>
                  </div>
                </div>
              )}
              {unopened.length > 0 && (
                <div className="mt-2 space-y-1">
                  {unopened.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-small text-muted-foreground">
                      <span>
                        {inv.invitedBy !== data.hostName
                          ? t(`sharePanel.unopened.${inv.role === "viewer" ? "viewer" : "collaborator"}From`, { name: inv.invitedBy })
                          : t(`sharePanel.unopened.${inv.role === "viewer" ? "viewer" : "collaborator"}`)}
                      </span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t("sharePanel.cancelThisInvite")}
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
              <SectionTitle>{t("sharePanel.inThisRoom")}</SectionTitle>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-body">
                  <span className="text-foreground">{t("sharePanel.nameYou", { name: data.hostName })}</span>
                  <span className="text-small text-muted-foreground">{t("sharePanel.owner")}</span>
                </div>
                {data.people.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-body">
                    <span className="min-w-0 truncate text-foreground">
                      {p.name}
                      {p.via && <span className="ml-1.5 text-small text-muted-foreground">{t("sharePanel.inPlatform", { platform: PLATFORM[p.via] })}</span>}
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
                        aria-label={t("sharePanel.roleOf", { name: p.name })}
                      >
                        <option value="collaborator">{t("sharePanel.collaborator")}</option>
                        <option value="viewer">{t("sharePanel.viewer")}</option>
                      </select>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t("sharePanel.removePerson", { name: p.name })}
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
              <SectionTitle>{t("sharePanel.roomSettings")}</SectionTitle>
              <div className="space-y-3">
                <Toggle
                  label={t("sharePanel.newPeopleSeeTheWhole")}
                  hint={t("sharePanel.offOnlyFromWhenThey")}
                  checked={shared.history === "all"}
                  onChange={(on) => share({ history: on ? "all" : "join" })}
                />
                <Toggle
                  label={t("sharePanel.collaboratorsCanInvite")}
                  hint={t("sharePanel.theyCanMakeInviteLinks")}
                  checked={shared.collaboratorsInvite}
                  onChange={(on) => share({ collaboratorsInvite: on })}
                />
                <Toggle
                  label={t("sharePanel.showWhatAgentsToolsDid")}
                  hint={t("sharePanel.offPeopleSeeThatAn")}
                  checked={shared.activityDetail}
                  onChange={(on) => share({ activityDetail: on })}
                />
                <Toggle
                  label={t("sharePanel.agentsCanWorkWithFiles")}
                  hint={t("sharePanel.offAgentsInThisRoom")}
                  checked={shared.tools === "desk"}
                  onChange={(on) => share({ tools: on ? "desk" : "conversation" })}
                />
              </div>
            </section>

            <ChatLinkSection blokId={blok.id} data={data} act={act} busy={busy !== null} />

            <OwnerToolsSection data={data} shared={shared} busy={busy !== null} share={share} />

            {/* what it costs */}
            <section>
              <SectionTitle>{t("sharePanel.spending")}</SectionTitle>
              <div className="text-body text-foreground">{t("sharePanel.monthlyCapForThisRoom")}</div>
              <div className="text-small leading-snug text-muted-foreground">
                {t("sharePanel.agentsHereUseYourEngines")}
              </div>
              <Slider
                aria-label={t("sharePanel.monthlyCap")}
                className="mt-3"
                stops={capStops(shared.spendCap ?? 0)}
                value={shared.spendCap ?? 0}
                onCommit={(spendCap) => share({ spendCap })}
              />
              {data.spend && (
                <div className="mt-3 rounded-xl border bg-card px-3 py-2.5">
                  <div className="flex items-baseline justify-between text-body">
                    <span className="text-muted-foreground">{t("sharePanel.thisMonth")}</span>
                    {data.spend.cap > 0 ? (
                      <span className="font-medium tabular-nums text-muted-foreground">
                        {tr("sharePanel.spentOfCap", { spent: <span className="text-foreground">{usd(data.spend.total)}</span>, cap: dollars(data.spend.cap) })}
                      </span>
                    ) : (
                      <span className="font-medium tabular-nums text-foreground">{usd(data.spend.total)}</span>
                    )}
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
                          <span className="truncate">{p.id === "owner" ? t("sharePanel.nameYou", { name: p.name }) : p.name}</span>
                          <span className="tabular-nums">{usd(p.usd)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 text-caption leading-snug text-muted-foreground">
                    {t("sharePanel.estimatedByWhoAsked")}
                  </div>
                </div>
              )}
            </section>

            <section className="border-t pt-4">
              {confirmStop ? (
                <div className="space-y-2">
                  <div className="text-body text-muted-foreground">
                    {t("sharePanel.everyoneLeavesTheRoomAnd")}
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
                      {t("sharePanel.stopSharing")}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmStop(false)}>
                      {t("sharePanel.keepSharing")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmStop(true)}>
                  {t("sharePanel.stopSharingThisRoom")}
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
      <SectionTitle>{t("sharePanel.chatChannel")}</SectionTitle>
      {link ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-body text-foreground">
            {tr("sharePanel.linkedTo", { channel: <span className="font-medium">{link.channelName}</span>, platform: PLATFORM[link.platform] })}
            <div className="text-small leading-snug text-muted-foreground">
              {t("sharePanel.messagesShowInBothPlaces")}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => act("unlink", () => api(`/api/bloks/${blokId}/chat`, { method: "DELETE" }))}
          >
            {t("sharePanel.unlink")}
          </Button>
        </div>
      ) : data.chat.connected.length === 0 ? (
        <div className="text-small leading-snug text-muted-foreground">
          {t("sharePanel.bringThisRoomIntoSlack")}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-small leading-snug text-muted-foreground">
            {t("sharePanel.bringThisRoomIntoA")}
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
              {t("sharePanel.findingChannels")}
            </div>
          )}
          {platform && channels && (
            channels.length === 0 ? (
              <div className="text-small leading-snug text-muted-foreground">
                {platform === "whatsapp" || platform === "signal"
                  ? t("sharePanel.noGroups", { platform: PLATFORM[platform] })
                  : t("sharePanel.noChannels", { platform: PLATFORM[platform] })}
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border bg-background px-2 text-body"
                  aria-label={t("sharePanel.channel")}
                >
                  <option value="">{t("sharePanel.pickAChannel")}</option>
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
                  {t("sharePanel.link")}
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
      <SectionTitle>{t("sharePanel.yourTools")}</SectionTitle>
      {!team ? (
        <div className="text-small leading-snug text-muted-foreground">
          {t("sharePanel.toolsNeedTeam")}{" "}
          <a
            href="https://bloks.dev/cloud/upgrade/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            {t("sharePanel.moveToTeam")}
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-small leading-snug text-muted-foreground">
            {t("sharePanel.agentsHereCanAskTo")}
          </div>
          {data.available.connectors && (
            <Toggle
              label={t("sharePanel.connectedApps")}
              hint={t("sharePanel.emailCalendarAndOtherConnected")}
              checked={Boolean(tools.connectors)}
              disabled={busy}
              onChange={(on) => set({ connectors: on })}
            />
          )}
          {data.available.mcp.map((server) => (
            <Toggle
              key={server.id}
              label={server.name}
              hint={t("sharePanel.anMcpServerForAgents")}
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
            label={t("sharePanel.aBrowser")}
            hint={t("sharePanel.aSeparateBrowserNotSigned")}
            checked={Boolean(tools.browser)}
            disabled={busy}
            onChange={(on) => set({ browser: on })}
          />
          {data.available.computer && (
            <Toggle
              label={t("sharePanel.yourComputer")}
              hint={t("sharePanel.theComputerYourAgentsUse")}
              checked={Boolean(tools.computer)}
              disabled={busy}
              onChange={(on) => set({ computer: on })}
            />
          )}
          <Toggle
            label={t("sharePanel.collaboratorsCanApprove")}
            hint={t("sharePanel.theyCanApproveRequestsExcept")}
            checked={Boolean(shared.collaboratorsApprove)}
            disabled={busy}
            onChange={(on) => share({ collaboratorsApprove: on })}
          />
          {anyOn && left.length > 0 && (
            <div className="text-small leading-snug text-muted-foreground">
              {t("sharePanel.cantPause", { count: left.length, agents: listed(left.map((a) => a.name)) })}
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
  if (data.plan !== "cloud" || !data.limits || data.sharedRoom === false) return null;
  return (
    <div className="mt-2 text-small leading-snug text-muted-foreground">
      {t("sharePanel.planLine", { members: data.limits.members })}{" "}
      <a
        href="https://bloks.dev/cloud/upgrade/"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline underline-offset-2"
      >
        {t("sharePanel.moveToTeam")}
      </a>
    </div>
  );
}
