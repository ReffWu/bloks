// Settings, Plan: the way to managed hosting, for a licence that has none.
//
// One card, kept apart from the page so the move itself can grow beside
// it without the page growing with it. It says what Hosting is in a line
// and three points, and offers one thing to press, chosen by what
// bloks.dev says: a Hosting offer on sale opens that upgrade (through the
// desktop app, so the key rides along in the fragment), one the site
// marks as not on sale yet wears "Coming soon" and points at the plans,
// and with no word on it at all the plans are the way, with no claim
// either way. Once the licence has Hosting, the page shows the Hosting row
// in this card's place.
import { ArrowUpRight, Check, Server } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { hostingOffer, ladderFor, planKey, type PlanKey, type PlanSnapshot } from "@/lib/plan";
import { openOffer, openSite } from "@/lib/planClient";

const POINTS = ["Always on", "Your phone and any browser reach it", "Nothing to set up: Bloks moves your agents over for you"];

/** The machine the person is on, as the line names it. */
function thisMachine(): string {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent) ? "Mac" : "computer";
}

/** What pressing does, from the offers: the upgrade itself, the plans
 * with Hosting picked, or the plans as they are. */
export function moveAction(snapshot: PlanSnapshot, key: PlanKey): { label: string; soon: boolean; go: () => void } {
  const pricing = `${snapshot.site}/pricing`;
  const offer = hostingOffer(ladderFor(key, snapshot.offers, snapshot.account));
  if (offer?.onSale) {
    const cta = offer.cta;
    return {
      label: "Choose a plan",
      soon: false,
      go: cta ? () => void openOffer(cta.url) : () => openSite(`${pricing}?plan=${encodeURIComponent(offer.id)}`),
    };
  }
  return { label: "See plans", soon: Boolean(offer), go: () => openSite(pricing) };
}

export function MoveToHostingCard({ snapshot, appPlan }: { snapshot: PlanSnapshot; appPlan?: "cloud" | "team" | null }) {
  const action = moveAction(snapshot, planKey(snapshot, appPlan));
  return (
    <section
      aria-label="Move to managed hosting"
      data-setting-row="move-to-managed-hosting"
      className="mb-9 rounded-2xl border bg-card p-5 transition-colors duration-700 last:mb-0"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Server size={18} />
        </span>
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-lead font-semibold text-foreground">Move to managed hosting</h2>
            {action.soon && <span className="rounded-full bg-muted px-2 py-0.5 text-small font-medium text-muted-foreground">Coming soon</span>}
          </div>
          <p className="mt-0.5 max-w-[60ch] text-pretty text-body text-muted-foreground">
            Your agents on a private machine of their own, so they keep working when this {thisMachine()} is asleep or off.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2 text-pretty text-small text-foreground">
                <Check size={14} strokeWidth={2.25} className="mt-[2px] shrink-0 text-brand-ink" />
                <span className="min-w-0">{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0 gap-1.5" onClick={action.go}>
          {action.label}
          <ArrowUpRight size={13} />
        </Button>
      </div>
    </section>
  );
}
