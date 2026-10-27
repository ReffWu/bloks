// A conversation with nothing in it yet.
//
// A blank page leaves the person to work out what this agent is for. So
// the page says who is here, and offers three ways in that fit its job
// (src/lib/starters.ts). Picking one only writes it into the message box,
// where it can be read, changed or finished; nothing is sent. Typing your
// own is still the main way, so the cards stay quiet and small.
import { motion } from "motion/react";
import { ArrowUpRight } from "@/components/icons";
import type { Bot } from "@/state/store";
import { startersFor } from "@/lib/starters";
import { AgentAvatar } from "../Avatar";
import { t } from "@/lib/i18n";

const settle = [0.23, 1, 0.32, 1] as const;

export function EmptyState({ bot, onStart }: { bot: Bot; onStart: (prompt: string) => void }) {
  const starters = startersFor(bot);
  return (
    <div className="my-auto flex w-full flex-col items-center px-1 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: settle }}
        className="flex flex-col items-center"
      >
        <AgentAvatar bot={bot} size={56} />
        <h2 className="mt-4 text-title font-semibold text-foreground">{bot.name}</h2>
        {bot.title && <p className="mt-0.5 max-w-[420px] text-body text-muted-foreground">{bot.title}</p>}
      </motion.div>

      <div className="mt-8 grid w-full max-w-[640px] grid-cols-1 gap-2 @[620px]/chat:grid-cols-3">
        {starters.map((starter, i) => (
          <motion.button
            key={starter.label}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 + i * 0.03, duration: 0.22, ease: settle }}
            onClick={() => onStart(starter.prompt)}
            className="group flex min-w-0 flex-col items-start gap-1 rounded-xl border bg-card px-3.5 py-3 text-left transition-[border-color,background-color,scale] duration-150 ease-out hover:border-foreground/20 hover:bg-accent/40 active:scale-[0.985]"
          >
            <span className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{starter.label}</span>
              <ArrowUpRight
                size={13}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </span>
            <span className="line-clamp-2 text-body text-muted-foreground">{starter.prompt.trim()}</span>
          </motion.button>
        ))}
      </div>
      <p className="mt-4 text-small text-muted-foreground">{t("emptyState.pickOneToFillThe")}</p>
    </div>
  );
}
