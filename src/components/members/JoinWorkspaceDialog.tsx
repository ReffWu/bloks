// Joining somebody's workspace from this Mac (designs: Mac-Join, the
// phone's Waiting and Welcome, Edge-States).
//
// Four moments, one dialog: finding the invite (paste a link or type the
// code, in any case, with or without the dash), asking (a name, and the
// password when the workspace wants one), waiting (the same four words the
// owner sees, to read out to each other), and the welcome. Every way it
// can go wrong has its own words, and none of them throws away what was
// typed: a wrong letter keeps the code so one letter can be fixed, a wrong
// password keeps the name.
//
// What joining actually changes on this Mac (a new workspace beside the
// others, opened through the remote proxy with these credentials) is the
// app shell's: `onJoined` hands over the credentials and the welcome, and
// this dialog changes nothing else.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { Ban, Check, Hourglass as Clock, Loader2, Users } from "@/components/icons";
import { BlokAvatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { BlokColor, BlokShape } from "@/lib/mascot";
import {
  codeIn,
  formatCode,
  joinApi,
  looksLikeInvite,
  ROLE_NAME,
  whenWords,
  type FoundInvite,
  type JoinCredentials,
  type JoinFailure,
  type Welcome,
} from "@/lib/members";
import { BlockConfetti } from "./BlockBurst";
import { WorkspaceMark } from "@/components/WorkspaceMark";

export interface Joined {
  credentials: JoinCredentials;
  welcome: Welcome;
  /** The person pressed Open, rather than closing the welcome. */
  open: boolean;
}

type Stage =
  | { kind: "enter" }
  | { kind: "found"; session: string; invite: FoundInvite }
  | { kind: "waiting"; session: string; invite: FoundInvite; phrase: string; unreachable?: boolean }
  | { kind: "welcome"; invite: FoundInvite; welcome: Welcome; credentials: JoinCredentials; name: string }
  | { kind: "ended"; code: string; error: string; invite?: FoundInvite; host?: string; workspace?: string };

/** People are called by their first name here, the way they would be in
 * the room: "Waiting for Hamed", not a full name on every line. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** How often a waiting request asks whether it has been answered. */
const POLL_MS = 2_500;

/** The edge screens' words (design: Edge-States), by the server's codes.
 * `inviter` is null when nobody said who sent the invite (Bloks Cloud only
 * knows an invite has ended, not whose it was). */
function ended(code: string, inviter: string | null, workspace: string | null, error: string): { title: string; body: string; note?: string } {
  const who = inviter ?? "whoever sent it";
  const Who = inviter ?? "Whoever sent it";
  const ws = workspace ?? "the workspace";
  switch (code) {
    case "expired":
      return { title: "This invite has expired", body: `Invites last 24 hours, so a code from yesterday stops working. Ask ${who} for a new one: it takes them a second.` };
    case "cancelled":
      return { title: "This invite was cancelled", body: `${Who} cancelled it, so it no longer works. Ask them for a new one: it takes them a second.` };
    case "used":
      return { title: "This invite was already used", body: `Each invite lets one person in, and somebody has used this one. Ask ${who} for a new one: it takes them a second.` };
    case "closed":
      return { title: "This invite is closed", body: `Too many wrong passwords were tried, so it stopped working, and ${who} has been told. Ask them for a new one.` };
    case "declined":
      return {
        title: inviter ? `${inviter} did not let this request in` : "This request was not let in",
        body: `If you think that is a mistake, check with ${who}. They can send you a new invite.`,
        note: "No reason is shown, and nothing about the workspace stays on this Mac.",
      };
    case "already_member":
      return {
        title: `You are already in ${ws}`,
        body: "This invite was for you, and you are in already. Nothing more to do.",
        note: `The invite stays unused, so ${who} can cancel it or give it to someone else.`,
      };
    case "full":
      return { title: `${ws} is full`, body: error };
    default:
      return { title: "That did not work", body: error };
  }
}

export function JoinWorkspaceDialog({
  open,
  onOpenChange,
  initialInput = "",
  currentWorkspace,
  onJoined,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A link or code to start from (a bloks://join link, say). */
  initialInput?: string;
  /** The workspace this window shows now, for "It opens beside ...". */
  currentWorkspace?: string;
  onJoined?: (joined: Joined) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "enter" });
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: "code" | "password" | "name" | "form"; text: string; note?: string } | null>(null);
  // A wrong code or password gives its field a small shake, in place: the
  // field is never remounted, so the focus and what was typed both stay.
  const [codeBox, animateCode] = useAnimate<HTMLDivElement>();
  const [passBox, animatePass] = useAnimate<HTMLDivElement>();
  const passInput = useRef<HTMLInputElement>(null);
  const [offer, setOffer] = useState<string | null>(null);
  const looked = useRef<string | null>(null);
  const reduce = useReducedMotion();

  // a fresh dialog each time it opens, filled in when it was given a link
  useEffect(() => {
    if (!open) return;
    setStage({ kind: "enter" });
    setInput(initialInput);
    setPassword("");
    setProblem(null);
    setOffer(null);
    looked.current = null;
    // a Bloks invite already on the clipboard is offered, never pasted
    // unasked: what is on somebody's clipboard is theirs
    if (!initialInput) {
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (looksLikeInvite(text)) setOffer(text.trim());
        })
        .catch(() => {});
    }
  }, [open, initialInput]);

  const lookup = useCallback(async (text: string) => {
    const code = codeIn(text);
    if (!code) return;
    looked.current = text;
    setBusy(true);
    setProblem(null);
    const found = await joinApi.lookup(text);
    setBusy(false);
    if (looked.current !== text) return;
    if (found.ok) {
      setStage({ kind: "found", session: found.session, invite: found.invite });
      return;
    }
    if (found.code === "wrong_code" || found.code === "not_a_code") {
      setProblem({ field: "code", text: "That code does not match an invite. Check each letter and try again.", note: "After a few wrong codes, Bloks asks you to wait a minute." });
      shakeBox(codeBox.current, animateCode);
      return;
    }
    if (found.code === "rate_limited" || found.code === "offline" || found.code === "host_outdated") {
      setProblem({ field: "code", text: found.error });
      return;
    }
    setStage({ kind: "ended", code: found.code, error: found.error, ...(found.host ? { host: found.host } : {}), ...(found.workspace ? { workspace: found.workspace } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shakeBox = (el: HTMLElement | null, run: typeof animateCode) => {
    if (!el || reduce) return;
    void run(el, { x: [0, -7, 6, -4, 3, 0] }, { duration: 0.36, ease: "easeOut" });
  };

  // Opened from the switcher's menu, the dialog can appear while the menu
  // is still closing, and the focus then lands nowhere. The field is the
  // one thing to do here, so it gets the focus once the menu has gone.
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const box = codeInput.current?.closest("[role=dialog]");
      if (codeInput.current && box && !box.contains(document.activeElement)) codeInput.current.focus();
    }, 180);
    return () => clearTimeout(t);
  }, [open]);

  // looked up as soon as what is typed can be a code; nothing to press
  useEffect(() => {
    if (!open || stage.kind !== "enter") return;
    if (!codeIn(input)) return;
    if (looked.current === input) return;
    const t = setTimeout(() => void lookup(input), 300);
    return () => clearTimeout(t);
  }, [input, open, stage.kind, lookup]);

  const failed = (answer: JoinFailure, invite: FoundInvite) => {
    const host = firstName(invite.inviter);
    if (answer.code === "password_required") {
      setProblem({ field: "password", text: `${invite.workspace} asks for a join password. ${host} can tell you what it is.` });
      setStage((s) => (s.kind === "found" ? { ...s, invite: { ...s.invite, password: true } } : s));
      return;
    }
    if (answer.code === "wrong_password") {
      const left = answer.triesLeft ?? 0;
      setProblem({
        field: "password",
        text: `That is not the password. Ask ${host} for it again. ${left} ${left === 1 ? "try" : "tries"} left on this invite.`,
        note: `After 5 wrong tries the invite closes, and ${host} is told someone guessed.`,
      });
      shakeBox(passBox.current, animatePass);
      // ready to type again: the wrong one selected, so typing replaces it
      requestAnimationFrame(() => passInput.current?.select());
      return;
    }
    if (answer.code === "invalid") {
      setProblem({ field: "name", text: "Your name is needed, so they know who is asking." });
      return;
    }
    if (answer.code === "unreachable" || answer.code === "offline") {
      setProblem({ field: "form", text: answer.error });
      return;
    }
    setStage({ kind: "ended", code: answer.code, error: answer.error, invite });
  };

  const ask = async () => {
    if (stage.kind !== "found") return;
    if (!name.trim()) {
      setProblem({ field: "name", text: "Your name is needed, so they know who is asking." });
      return;
    }
    setBusy(true);
    setProblem(null);
    const answer = await joinApi.claim(stage.session, name.trim(), password || undefined);
    setBusy(false);
    if (!answer.ok) return failed(answer, stage.invite);
    if (answer.status === "approved") {
      setStage({ kind: "welcome", invite: stage.invite, welcome: answer.welcome, credentials: answer.credentials, name: name.trim() });
      return;
    }
    setStage({ kind: "waiting", session: stage.session, invite: stage.invite, phrase: answer.phrase });
  };

  // waiting: ask now and then whether the owner has answered
  useEffect(() => {
    if (!open || stage.kind !== "waiting") return;
    let alive = true;
    const tick = async () => {
      const answer = await joinApi.status(stage.session);
      if (!alive) return;
      if (answer.ok && answer.status === "approved") {
        setStage({ kind: "welcome", invite: stage.invite, welcome: answer.welcome, credentials: answer.credentials, name: name.trim() });
        return;
      }
      if (answer.ok) {
        if (stage.unreachable) setStage({ ...stage, unreachable: false });
        return;
      }
      if (answer.code === "unreachable" || answer.code === "offline") {
        if (!stage.unreachable) setStage({ ...stage, unreachable: true });
        return;
      }
      setStage({ kind: "ended", code: answer.code, error: answer.error, invite: stage.invite });
    };
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, stage, name]);

  const close = (next: boolean) => {
    if (next) return;
    // a request still waiting stays waiting: leaving is allowed, as the
    // design says, and the owner can still let them in
    if (stage.kind === "welcome") onJoined?.({ credentials: stage.credentials, welcome: stage.welcome, open: false });
    onOpenChange(false);
  };

  const cancelRequest = async () => {
    if (stage.kind === "waiting") await joinApi.cancel(stage.session).catch(() => {});
    onOpenChange(false);
  };

  const invite = "invite" in stage && stage.invite ? { ...stage.invite, inviter: firstName(stage.invite.inviter) } : undefined;
  const title =
    stage.kind === "welcome" ? "You're in" : stage.kind === "waiting" ? `Waiting for ${firstName(stage.invite.inviter)}` : stage.kind === "ended" ? ended(stage.code, invite?.inviter ?? (stage.host ? firstName(stage.host) : null), invite?.workspace ?? stage.workspace ?? null, stage.error).title : "Join a workspace";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={stage.kind !== "welcome"} className="w-[calc(100%-2rem)] max-w-[560px] overflow-hidden p-6" aria-describedby={undefined}>
        {stage.kind === "welcome" && <BlockConfetti color={stage.welcome.workspace.mark.color} />}
        {stage.kind === "ended" && (
          <span className="mb-3 grid size-11 place-items-center rounded-[14px] bg-muted text-muted-foreground" aria-hidden>
            {stage.code === "expired" ? <Clock size={22} /> : stage.code === "already_member" ? <Check size={22} /> : stage.code === "full" ? <Users size={22} /> : <Ban size={22} />}
          </span>
        )}
        <DialogTitle className={cn("text-balance text-heading font-bold", stage.kind === "welcome" && "sr-only")}>{title}</DialogTitle>

        {(stage.kind === "enter" || stage.kind === "found") && (
          <div className="mt-1.5 flex flex-col gap-[18px]">
            <DialogDescription className="mt-0">Paste the invite link, or type its 8-character code.</DialogDescription>
            <label className="flex flex-col gap-1.5">
              <span className="text-small text-muted-foreground">Invite link or code</span>
              <div ref={codeBox}>
                <Input
                  ref={codeInput}
                  autoFocus={!initialInput}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setProblem(null);
                    if (stage.kind === "found") setStage({ kind: "enter" });
                  }}
                  placeholder="bloks.dev/j/... or K7QF-M2XR"
                  spellCheck={false}
                  autoCapitalize="characters"
                  aria-invalid={problem?.field === "code"}
                  className={cn("h-[42px] font-mono font-semibold tracking-wide", problem?.field === "code" && "border-destructive focus-visible:border-destructive")}
                />
              </div>
            </label>
            {offer && stage.kind === "enter" && !input && (
              <button
                type="button"
                onClick={() => setInput(offer)}
                className="-mt-2.5 flex items-center gap-2 self-start rounded-lg px-2 py-1 text-body text-brand-ink transition-colors duration-150 hover:bg-brand-soft"
              >
                Use the invite on your clipboard: <span className="font-mono">{formatCode(codeIn(offer) ?? "")}</span>
              </button>
            )}
            {problem?.field === "code" && (
              <div className="-mt-2.5 flex flex-col gap-0.5" role="alert">
                <span className="text-body text-destructive">{problem.text}</span>
                {problem.note && <span className="text-small text-muted-foreground">{problem.note}</span>}
              </div>
            )}
            {busy && stage.kind === "enter" && (
              <div className="flex items-center gap-2 text-body text-muted-foreground" role="status">
                <Loader2 size={14} className="animate-spin" />
                Looking it up
              </div>
            )}

            {stage.kind === "found" && (
              <>
                <div className="flex animate-rise-in items-center gap-3.5 rounded-[14px] border bg-muted/50 p-3.5">
                  <WorkspaceMark mark={stage.invite.mark} size={36} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold text-foreground">{stage.invite.workspace}</span>
                    <span className="truncate text-body text-muted-foreground">
                      From {firstName(stage.invite.inviter)} · as {stage.invite.role === "admin" ? "an" : "a"} {ROLE_NAME[stage.invite.role]}
                      {stage.invite.expiresAt ? ` · expires ${whenWords(stage.invite.expiresAt)}` : ""}
                    </span>
                  </div>
                  <Check size={18} className="text-success" aria-label="Invite found" />
                </div>
                <div className="flex gap-3 max-sm:flex-col">
                  <label className="flex flex-1 flex-col gap-1.5">
                    <span className="text-small text-muted-foreground">Your name</span>
                    <Input
                      autoFocus
                      value={name}
                      maxLength={40}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (problem?.field === "name") setProblem(null);
                      }}
                      autoComplete="name"
                      aria-invalid={problem?.field === "name"}
                      className={cn("h-10", problem?.field === "name" && "border-destructive")}
                    />
                  </label>
                  {stage.invite.password !== false && (
                    <label className="flex flex-1 flex-col gap-1.5">
                      <span className={cn("text-small", problem?.field === "password" ? "text-destructive" : "text-muted-foreground")}>
                        Join password{stage.invite.password === null ? " (if asked)" : ""}
                      </span>
                      <div ref={passBox}>
                        <Input
                          ref={passInput}
                          type="password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (problem?.field === "password") setProblem(null);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && void ask()}
                          autoComplete="off"
                          aria-invalid={problem?.field === "password"}
                          className={cn("h-10 tracking-[0.12em]", problem?.field === "password" && "border-destructive")}
                        />
                      </div>
                    </label>
                  )}
                </div>
                {problem && problem.field !== "code" && (
                  <div className="-mt-2 flex flex-col gap-0.5" role="alert">
                    <span className="text-pretty text-body text-destructive">{problem.text}</span>
                    {problem.note && <span className="text-pretty text-small text-muted-foreground">{problem.note}</span>}
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2.5">
              <span className="flex-1 text-pretty text-small text-muted-foreground">
                {currentWorkspace ? `It opens beside ${currentWorkspace}. Nothing moves between them.` : "It opens beside your own workspace. Nothing moves between them."}
              </span>
              <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="lg" disabled={stage.kind !== "found" || busy} onClick={() => void ask()}>
                {busy && stage.kind === "found" && <Loader2 size={14} className="animate-spin" />}
                Ask to join
              </Button>
            </div>
          </div>
        )}

        {stage.kind === "waiting" && (
          <div className="mt-1.5 flex flex-col gap-5">
            <DialogDescription className="mt-0">
              Your request is on {firstName(stage.invite.inviter)}'s screen. Read these words to each other. If they match, {firstName(stage.invite.inviter)} lets you in.
            </DialogDescription>
            <div role="group" aria-label={`Check words: ${stage.phrase.split(" ").join(", ")}`} className="grid grid-cols-4 gap-2.5 max-sm:grid-cols-2">
              {stage.phrase.split(" ").map((word, i) => (
                <div key={i} className="flex animate-rise-in flex-col gap-0.5 rounded-xl border bg-muted/50 px-3.5 py-3" style={{ animationDelay: `${i * 50}ms`, animationFillMode: "backwards" }}>
                  <span className="text-caption font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="truncate text-[20px] font-bold leading-tight text-foreground">{word}</span>
                </div>
              ))}
            </div>
            <div role="status" className="flex items-center justify-center gap-2.5 text-pretty text-ui text-muted-foreground">
              {stage.unreachable ? (
                <>
                  <Clock size={18} className="shrink-0" />
                  {firstName(stage.invite.inviter)}'s computer is not reachable. It may be asleep or offline; your request is saved, and goes through the moment it wakes.
                </>
              ) : (
                <>
                  <span className="size-2 rounded-full motion-safe:animate-pulse" style={{ background: stage.invite.mark.color }} />
                  {firstName(stage.invite.inviter)}'s computer has your request
                </>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex-1 text-pretty text-small text-muted-foreground">You can leave this open, or close it: you will be let in all the same.</span>
              <Button variant="ghost" size="lg" className="text-destructive hover:text-destructive" onClick={() => void cancelRequest()}>
                Cancel request
              </Button>
            </div>
          </div>
        )}

        {stage.kind === "welcome" && (
          <div className="relative z-10 flex flex-col items-center gap-3.5 pt-4 text-center">
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "scale(0.9)" }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.25 }}
              className="grid size-24 place-items-center rounded-[30px]"
              style={{ background: `color-mix(in srgb, ${stage.welcome.workspace.mark.color} 14%, transparent)` }}
            >
              <WorkspaceMark mark={stage.welcome.workspace.mark} size={64} />
            </motion.div>
            <p aria-hidden className="mt-1 text-[32px] font-extrabold leading-tight tracking-[-0.03em] text-foreground">
              You're in
            </p>
            <p className="text-pretty text-lead text-muted-foreground">
              Welcome to {stage.welcome.workspace.name}, {stage.name.split(" ")[0]}.<br />
              {firstName(stage.welcome.approvedBy)} let you in as {stage.welcome.role === "admin" ? "an" : "a"} {ROLE_NAME[stage.welcome.role]}.
            </p>
            {stage.welcome.agents.length > 0 && (
              <div className="mt-3 flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left">
                <span className="text-body font-medium text-muted-foreground">Meet the team</span>
                <div className="grid grid-cols-4 gap-2">
                  {stage.welcome.agents.slice(0, stage.welcome.agentCount > 4 ? 3 : 4).map((a, i) => (
                    <div key={a.id} className="flex animate-rise-in flex-col items-center gap-1.5" style={{ animationDelay: `${120 + i * 60}ms`, animationFillMode: "backwards" }}>
                      <BlokAvatar color={a.color as BlokColor} shape={(a.shape ?? undefined) as BlokShape | undefined} size={48} />
                      <span className="line-clamp-2 text-center text-small leading-tight text-foreground">{a.name}</span>
                    </div>
                  ))}
                  {stage.welcome.agentCount > 4 && (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="grid size-12 place-items-center rounded-[14px] bg-muted text-ui font-semibold tabular-nums text-muted-foreground">+{stage.welcome.agentCount - 3}</span>
                      <span className="text-small text-foreground">More</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <Button
              size="lg"
              className="mt-3 h-12 w-full rounded-2xl text-lead"
              onClick={() => {
                onJoined?.({ credentials: stage.credentials, welcome: stage.welcome, open: true });
                onOpenChange(false);
              }}
            >
              Open {stage.welcome.workspace.name}
            </Button>
          </div>
        )}

        {stage.kind === "ended" && (
          <EndedView
            stage={stage}
            onDone={() => onOpenChange(false)}
            onRetry={() => {
              setStage({ kind: "enter" });
              looked.current = null;
            }}
            onOpen={
              stage.code === "already_member" && invite
                ? () => {
                    onOpenChange(false);
                  }
                : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EndedView({
  stage,
  onDone,
  onRetry,
  onOpen,
}: {
  stage: Extract<Stage, { kind: "ended" }>;
  onDone: () => void;
  onRetry: () => void;
  onOpen?: () => void;
}) {
  const inviter = stage.invite ? firstName(stage.invite.inviter) : stage.host ? firstName(stage.host) : null;
  const workspace = stage.invite?.workspace ?? stage.workspace ?? null;
  const words = ended(stage.code, inviter, workspace, stage.error);
  return (
    <div className="mt-1.5 flex flex-col gap-3">
      <DialogDescription className="mt-0 text-pretty text-ui leading-relaxed">{words.body}</DialogDescription>
      {words.note && <p className="text-pretty text-small text-muted-foreground">{words.note}</p>}
      <div className="mt-3 flex justify-end gap-2">
        {stage.code !== "declined" && stage.code !== "already_member" && (
          <Button variant="ghost" size="lg" onClick={onRetry}>
            Try another code
          </Button>
        )}
        {onOpen ? (
          <Button size="lg" onClick={onOpen}>
            Open {workspace ?? "the workspace"}
          </Button>
        ) : (
          <Button size="lg" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
