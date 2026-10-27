// The Composio key, asked for where it is needed.
//
// Connecting an app used to start with a trip to Settings: press Connect,
// find it greyed out, go looking for Apps and keys, come back. Now Connect
// opens this instead, takes the key on the spot, and carries straight on
// into the app's sign-in, so it reads as one motion. Opened from "Add a
// key" on the Plugins page, it takes the key and leaves the catalogue live.
//
// Two tabs: the field, and a short How to for someone who has never seen
// Composio's dashboard. The key is write-only like every other key row:
// typed, sent, and gone from the screen. Nothing prefills it, nothing logs
// it, and closing the dialog drops whatever was half typed.
import { useRef, useState } from "react";
import { Check } from "@/components/icons";
import { ExternalLink } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { useStore } from "@/state/store";
import type { Connectors, ToolkitCard } from "@/lib/useConnectors";
import { composioKeyMistake } from "@/lib/keyShape";
import { saveApiKey } from "./ApiKeys";
import { ServiceIcon } from "./Customize";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { t, tr } from "@/lib/i18n";

const COMPOSIO = "https://composio.dev";

/** How a Connect key and a project API key begin, as Composio prints them. */
const CONNECT_PREFIX = "ck_";
const PROJECT_PREFIX = "ak_";

/** Composio's dashboard, in its own words: the person looks for these on
 * a page that is in English whatever language Bloks is read in. */
const DASHBOARD = {
  forYou: "For You",
  settings: "Settings",
  sessions: "Sessions & API Key",
  apiKey: "Your API Key",
};

export function ComposioKeyDialog({ connectors }: { connectors: Connectors }) {
  const ask = connectors.keyAsk;
  const card = ask?.slug ? (connectors.cards?.find((c) => c.slug === ask.slug) ?? null) : null;

  const saved = () => {
    connectors.keySaved();
    if (card) {
      toast.success(t("composioKeyDialog.keySaved"), { description: t("composioKeyDialog.finishSigningIn", { app: card.label }) });
    } else {
      toast.success(t("composioKeyDialog.keySaved"), { description: t("composioKeyDialog.everyAppReady") });
    }
  };

  return (
    <Dialog open={ask !== null} onOpenChange={(open) => !open && connectors.closeKeyAsk()}>
      <DialogContent className="w-[calc(100%-32px)] max-w-[460px] p-6 sm:p-7">
        {/* mounted only while open, so a half-typed key never outlives it */}
        {ask && <KeyBody card={card} cards={connectors.ordered} onSaved={saved} />}
      </DialogContent>
    </Dialog>
  );
}

function KeyBody({
  card,
  cards,
  onSaved,
}: {
  card: ToolkitCard | null;
  cards: ToolkitCard[];
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"key" | "how">("key");
  const inputRef = useRef<HTMLInputElement>(null);
  const toKey = () => {
    setTab("key");
    // after the field is back on screen
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <>
      <Marks card={card} cards={cards} />
      <DialogTitle className="mt-4">{card ? t("composioKeyDialog.connectApp", { app: card.label }) : t("composioKeyDialog.connectYourApps")}</DialogTitle>
      <DialogDescription>
        {card
          ? t("composioKeyDialog.addKeyThenSignIn", { app: card.label })
          : t("composioKeyDialog.oneComposioKeyConnectsEvery")}
      </DialogDescription>

      <Segmented
        aria-label={t("composioKeyDialog.addAKeyOrHow")}
        value={tab}
        onChange={(next) => (next === "key" ? toKey() : setTab(next))}
        options={[
          { value: "key", label: t("composioKeyDialog.addKey") },
          { value: "how", label: t("composioKeyDialog.howTo") },
        ]}
        className="mt-5"
      />

      {/* both tabs keep the same height, so switching never jolts the
          dialog; the swap is a fade, which says "same place, other page" */}
      <div className="mt-5 min-h-[212px]">
        {tab === "key" ? (
          <div key="key" className="animate-fade-in">
            <KeyField inputRef={inputRef} connecting={card?.label ?? null} onSaved={onSaved} />
            <CatalogueKey />
          </div>
        ) : (
          <div key="how" className="animate-fade-in">
            <HowTo onDone={toKey} />
          </div>
        )}
      </div>
    </>
  );
}

/** The app being connected, on its own; or a fan of a few apps, which says
 * "all of these" before a word is read. */
function Marks({ card, cards }: { card: ToolkitCard | null; cards: ToolkitCard[] }) {
  const tile =
    "flex size-11 items-center justify-center rounded-2xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-4 ring-popover";
  if (card) {
    return (
      <span className={tile}>
        <ServiceIcon card={card} size={26} />
      </span>
    );
  }
  return (
    <div className="flex">
      {cards.slice(0, 5).map((c, i) => (
        <span key={c.slug} className={cn(tile, i > 0 && "-ml-2.5")} style={{ zIndex: 5 - i }}>
          <ServiceIcon card={c} size={24} />
        </span>
      ))}
    </div>
  );
}

/** What the field says about what is in it, before anything is sent:
 * which kind of key it looks like, said plainly. The server still has the
 * last word, since only Composio knows whether a key is real. */
function shapeOf(value: string): { tone: "quiet" | "good" | "warn" | "bad"; text: string } {
  const key = value.trim();
  const mistake = composioKeyMistake("composio", key);
  if (mistake) return { tone: "bad", text: mistake };
  if (!key || CONNECT_PREFIX.startsWith(key)) return { tone: "quiet", text: t("composioKeyDialog.startsWith", { prefix: CONNECT_PREFIX }) };
  if (key.startsWith(CONNECT_PREFIX)) return { tone: "good", text: t("composioKeyDialog.looksLikeConnectKey") };
  return { tone: "warn", text: t("composioKeyDialog.connectKeysStartWith", { prefix: CONNECT_PREFIX }) };
}

const TONE = {
  quiet: "text-muted-foreground",
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
} as const;

function KeyField({
  inputRef,
  connecting,
  onSaved,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The app to connect once saved, named on the button. */
  connecting: string | null;
  onSaved: () => void;
}) {
  const { dispatch } = useStore();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const shape = shapeOf(value);
  const blocked = !value.trim() || shape.tone === "bad";

  const save = () => {
    if (saving || done || blocked) return;
    setSaving(true);
    setRefusal(null);
    saveApiKey("composio", value, dispatch)
      .then(() => {
        setValue("");
        setDone(true);
        // long enough to see the tick land, short enough to feel like one
        // step into the sign-in
        setTimeout(onSaved, 450);
      })
      .catch((e: Error) => setRefusal(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <label htmlFor="composio-connect-key" className="text-body font-medium text-foreground">
        {t("composioKeyDialog.connectKey")}
      </label>
      <Input
        id="composio-connect-key"
        ref={inputRef}
        type="password"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setRefusal(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder={`${CONNECT_PREFIX}…`}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        disabled={done}
        aria-describedby="composio-connect-key-hint"
        aria-invalid={Boolean(refusal) || shape.tone === "bad"}
        className="mt-1.5 h-10"
      />
      <p
        id="composio-connect-key-hint"
        aria-live="polite"
        className={cn("mt-1.5 min-h-5 text-small", done ? TONE.good : refusal ? TONE.bad : TONE[shape.tone])}
      >
        {done ? (connecting ? t("composioKeyDialog.savedOpening", { app: connecting }) : t("composioKeyDialog.saved")) : refusal ? `${refusal}.`.replace(/\.\.$/, ".") : shape.text}
      </p>
      <Button size="lg" onClick={save} disabled={saving || done || blocked} className="mt-3 w-full">
        {saving ? (
          <>
            <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
            {t("composioKeyDialog.checkingWithComposio")}
          </>
        ) : done ? (
          <>
            <Check size={15} />
            {t("common.saved")}
          </>
        ) : connecting ? (
          t("composioKeyDialog.saveAndConnect", { app: connecting })
        ) : (
          t("common.save")
        )}
      </Button>
    </div>
  );
}

/** The optional second key, folded away: most people never need it, and
 * the ones who do are looking for exactly this line. */
function CatalogueKey() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const has = state.config?.composio.apiKeyConfigured ?? false;

  const save = () => {
    if (saving || !value.trim()) return;
    setSaving(true);
    setVerdict(null);
    saveApiKey("composioApi", value, dispatch)
      .then(() => {
        setValue("");
        setVerdict({ ok: true, text: t("composioKeyDialog.fullCatalogueOn") });
      })
      .catch((e: Error) => setVerdict({ ok: false, text: e.message }))
      .finally(() => setSaving(false));
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 text-left text-small text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        {has ? t("composioKeyDialog.projectApiKeySavedReplace") : t("composioKeyDialog.haveAProjectApiKey")}
      </button>
    );
  }
  return (
    <div className="mt-4 animate-fade-in">
      <label htmlFor="composio-project-key" className="text-small font-medium text-foreground">
        {t("composioKeyDialog.projectApiKey")}
      </label>
      <div className="mt-1 flex gap-2">
        <Input
          id="composio-project-key"
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setVerdict(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={`${PROJECT_PREFIX}…`}
          autoComplete="off"
          spellCheck={false}
          className="h-8 text-body"
        />
        <Button variant="secondary" onClick={save} disabled={saving || !value.trim()} className="w-[72px]">
          {saving ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> : t("common.save")}
        </Button>
      </div>
      <p aria-live="polite" className={cn("mt-1.5 text-small", verdict ? (verdict.ok ? TONE.good : TONE.bad) : TONE.quiet)}>
        {verdict ? verdict.text : t("composioKeyDialog.optionalItShowsEveryApp")}
      </p>
    </div>
  );
}

/** Four steps, the way Composio's dashboard is laid out today (For You,
 * Settings, Sessions and API Key, per their own guide), and nothing a
 * person would have to read twice. */
function HowTo({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <ol className="flex flex-col gap-3.5">
        <Step
          n={1}
          aside={
            <a
              href={COMPOSIO}
              target="_blank"
              rel="noreferrer"
              className="-my-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-body font-medium text-foreground transition-colors hover:bg-accent"
            >
              {t("common.open")}
              <ExternalLink size={13} />
            </a>
          }
        >
          {t("composioKeyDialog.openComposioDevAndSign")}
        </Step>
        <Step n={2}>
          {tr("composioKeyDialog.step2", {
            forYou: <Em>{DASHBOARD.forYou}</Em>,
            settings: <Em>{DASHBOARD.settings}</Em>,
            sessions: <Em>{DASHBOARD.sessions}</Em>,
          })}
        </Step>
        <Step n={3}>
          {tr("composioKeyDialog.step3", {
            apiKey: <Em>{DASHBOARD.apiKey}</Em>,
            prefix: <code className="rounded bg-muted px-1 py-px font-mono text-small text-foreground">{CONNECT_PREFIX}</code>,
          })}
        </Step>
        <Step n={4}>{t("composioKeyDialog.pasteItInAddKey")}</Step>
      </ol>
      <Button variant="secondary" onClick={onDone} className="mt-4 w-full" size="lg">
        {t("composioKeyDialog.iHaveMyKey")}
      </Button>
    </div>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function Step({ n, children, aside }: { n: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold tabular-nums text-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-ui leading-snug text-muted-foreground">{children}</div>
      {aside}
    </li>
  );
}
