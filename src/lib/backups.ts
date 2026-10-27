// The words the Backups page says, kept apart from the page so they can
// be held to what the server actually does (server/backup.ts).
//
// A restore replaces everything, so what its confirmation promises has
// to be exactly true: what happens first, what is kept, and what happens
// to the keys. Getting the keys sentence wrong would tell somebody their
// engines stay signed in when they are about to be replaced, or the other
// way round.

import { formatList, formatNumber, t } from "./i18n.ts";

/** "move" is a whole workspace written out for another machine. */
export type BackupKind = "manual" | "automatic" | "before-restore" | "move";

export interface BackupItem {
  name: string;
  path: string;
  size: number;
  created: number;
  kind: BackupKind;
  version: string;
  undo: boolean;
  secrets: boolean;
  encrypted: boolean;
  damaged?: boolean;
}

export interface RestoreProgress {
  phase: "draining" | "backing-up" | "staging" | "restarting" | "failed" | "cancelled";
  from: string;
  running?: number;
  deadline?: number;
  error?: string;
}

// one decimal for the big units, as "12.4 MB" always read
const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return t("backups.size.gb", { size: formatNumber(bytes / 1e9, oneDecimal) });
  if (bytes >= 1e6) return t("backups.size.mb", { size: formatNumber(bytes / 1e6, oneDecimal) });
  return t("backups.size.kb", { size: Math.max(1, Math.round(bytes / 1e3)) });
}

export function kindLabel(kind: BackupKind): string | null {
  if (kind === "automatic") return t("backups.kind.automatic");
  if (kind === "before-restore") return t("backups.kind.beforeRestore");
  if (kind === "move") return t("backups.kind.move");
  return null;
}

/** One line under a backup's date: what made it and what it holds. */
export function backupDetails(backup: BackupItem): string {
  if (backup.damaged) return t("backups.details.damaged", { size: sizeText(backup.size) });
  return [
    backup.version ? t("backups.details.version", { version: backup.version }) : null,
    sizeText(backup.size),
    backup.encrypted ? t("backups.details.sealed") : null,
    backup.undo ? t("backups.details.withUndo") : null,
    backup.secrets ? t("backups.details.withKeys") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Where the workspace a restore replaces is moved, as a person would
 * look for it: beside the data folder, which is beside the backups. */
export function asideFolder(backupsFolder: string): string {
  return `${backupsFolder.replace(/-backups$/, "")}.before-restore-…`;
}

/** What happens, in order, and what it means for this backup. */
export function restoreSteps(backup: BackupItem, backupsFolder: string): { steps: string[]; notes: string[] } {
  const steps = [
    t("backups.restore.stepDrain"),
    t("backups.restore.stepBackUp"),
    t("backups.restore.stepCheck"),
    t("backups.restore.stepAside", { folder: asideFolder(backupsFolder) }),
    t("backups.restore.stepRestart"),
  ];
  const notes = [backup.secrets ? t("backups.restore.keysReplaced") : t("backups.restore.keysKept")];
  if (!backup.undo) notes.push(t("backups.restore.noUndo"));
  return { steps, notes };
}

/** What a restore under way is doing, in a sentence. */
export function restoreLine(progress: RestoreProgress, now = Date.now()): string {
  switch (progress.phase) {
    case "draining": {
      const n = progress.running ?? 0;
      if (n === 0) return t("backups.restore.gettingReady");
      const left = progress.deadline ? Math.max(0, Math.ceil((progress.deadline - now) / 60_000)) : null;
      if (left === null) return t("backups.restore.waiting", { count: n });
      // two counts in one sentence: the minutes are a phrase of their own
      return t("backups.restore.waitingUpTo", { count: n, minutes: t("backups.restore.moreMinutes", { count: left }) });
    }
    case "backing-up":
      return t("backups.restore.backingUp");
    case "staging":
      return t("backups.restore.staging");
    case "restarting":
      return t("backups.restore.restarting");
    case "cancelled":
      return t("backups.restore.cancelled");
    case "failed": {
      // the server's own reason, which already says so when nothing changed
      const why = progress.error ?? t("backups.restore.somethingWentWrong");
      return /nothing was changed/i.test(why)
        ? t("backups.restore.stopped", { reason: why })
        : t("backups.restore.stoppedNothingChanged", { reason: why });
    }
  }
}

export function passphraseProblem(passphrase: string, again: string): string | null {
  if (passphrase.length < 8) return t("backups.passphrase.tooShort", { count: 8 });
  if (passphrase !== again) return t("backups.passphrase.differ");
  return null;
}

/** What a workspace move asks of the person afterwards: the keys it left
 * behind, by name, since keys never travel in a move. */
export function keysToEnter(labels: string[]): string {
  const names = [...new Set(labels.filter(Boolean))];
  if (!names.length) return t("backups.keysToEnter.none");
  return t("backups.keysToEnter.some", { count: names.length, list: formatList(names) });
}
