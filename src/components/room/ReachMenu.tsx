// Who answers, said under a room's box where the next message is written.
//
// An agent's composer says there how much the agent asks and which model
// it runs; a room has several of each, so neither belongs. What a room's
// next message needs is who it reaches, and that changes as it is typed:
// everyone, the lead, whoever Auto picks, or exactly who was named. The
// same word opens the room's one setting about it, and a way to name
// someone without typing.
import { Check } from "@/components/icons";
import { Crown } from "@/components/icons";
import { Sparkles } from "@/components/icons";
import { Users } from "@/components/icons";
import { api, type Blok, type Bot } from "@/state/store";
import { AgentAvatar } from "@/components/Avatar";
import { quietButton } from "@/components/composer/Shell";
import { namesLine } from "@/lib/roomVoices";
import { ROOM_ANSWERS, answersOf, answersWords, type RoomAnswers } from "@/lib/roomRoute";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Reach } from "./reach";
import { t } from "@/lib/i18n";

export function ReachMenu({
  blok,
  reach,
  members,
  answering,
  lead,
  onMention,
}: {
  blok: Blok;
  reach: Reach;
  /** Everyone in the room, so a name typed for an archived member still
   * shows as who it was for. */
  members: Bot[];
  /** Those who can answer, the lead first. */
  answering: Bot[];
  lead: Bot | null;
  onMention: (name: string) => void;
}) {
  const answers = answersOf(blok);
  const named = reach.kind === "named" ? reach.ids.map((id) => members.find((m) => m.id === id)).filter(Boolean) as Bot[] : [];
  const line =
    reach.kind === "named"
      ? `To ${namesLine(named.map((m) => m.name))}`
      : reach.kind === "lead"
        ? `${lead?.name ?? "The lead"} answers`
        : reach.kind === "auto"
          ? "Auto picks who answers"
          : reach.kind === "people"
          ? "No agent answers"
          : answering.length === 1
            ? `${answering[0].name} answers`
            : "Everyone answers";
  const icon =
    reach.kind === "named" ? (
      <span className="flex shrink-0 -space-x-1">
        {named.slice(0, 3).map((m) => (
          <AgentAvatar key={m.id} bot={m} size={16} className="rounded-[5px] ring-2 ring-background" />
        ))}
      </span>
    ) : reach.kind === "lead" ? (
      <Crown size={14} className="shrink-0 text-brand-ink" />
    ) : reach.kind === "auto" ? (
      <Sparkles size={14} className="shrink-0 text-brand-ink" />
    ) : (
      <Users size={14} className="shrink-0" />
    );

  const setAnswers = (next: RoomAnswers) => {
    if (next === answers) return;
    api(`/api/bloks/${blok.id}`, { method: "PATCH", body: JSON.stringify({ answers: next }) }).catch(() => {});
  };
  const choices = ROOM_ANSWERS.map((value) => ({
    on: answers === value,
    ...answersWords(value, lead?.name ?? null),
    pick: () => setAnswers(value),
  }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={`Who answers: ${line}`} aria-label={`Who answers: ${line}`} className={quietButton}>
          {icon}
          <span className="truncate">{line}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-[280px] max-w-[calc(100vw-24px)]">
        {answering.length > 1 && (
          <>
            <DropdownMenuLabel>{t("reachMenu.whoAnswers")}</DropdownMenuLabel>
            {choices.map((c) => (
              <DropdownMenuItem
                key={c.label}
                onSelect={c.pick}
                role="menuitemradio"
                aria-checked={c.on}
                className="items-start gap-2.5 py-2 [&_svg]:text-inherit"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-brand-ink">
                  {c.on && <Check size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{c.label}</span>
                  <span className="block text-pretty text-small leading-snug text-muted-foreground">{c.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{t("reachMenu.askSomeone")}</DropdownMenuLabel>
        {answering.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => onMention(m.name)} className="[&_svg]:text-inherit">
            <AgentAvatar bot={m} size={16} className={cn(!m.avatarAt && "rounded-[5px]")} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.id === lead?.id && answering.length > 1 && (
              <span className="flex text-brand-ink" title={t("reachMenu.lead")}>
                <Crown size={12} />
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
