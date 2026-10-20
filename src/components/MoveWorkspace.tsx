// Moving the whole workspace to a hosted one, on the Backups page.
//
// Two halves, and a workspace usually shows one of them. Where the work
// is, one file is written out: every agent, lane, room, routine, watcher,
// intent, memory, skill and setting, with the keys left behind and named
// (server/workspace-move.ts). Where it is going, an empty workspace takes
// that file in and restarts to put it in place. Nothing is ever moved
// over somebody's work: a workspace with anything in it does not offer
// the second half, and the server refuses it anyway.
import { useEffect, useRef, useState } from "react";
import { Download } from "@/components/icons";
import { FolderOpen } from "@/components/icons";
import { Loader2 } from "@/components/icons";
import { Upload } from "@/components/icons";
import { api } from "@/state/store";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { deviceWord } from "@/lib/thisComputer";
import { keysToEnter } from "@/lib/backups";
import { SettingRow, SettingsGroup } from "./SettingsLayout";

interface MoveStatus {
  empty: boolean;
  hosted: boolean;
  /** Writing one out answers only the computer the workspace is on. */
  canWrite?: boolean;
}

interface Written {
  name: string;
  toEnter: string[];
}

/** The pid of the server answering now, to tell a restarted one apart. */
const serverPid = () =>
  fetch("/api/health")
    .then((r) => (r.ok ? r.json() : null))
    .then((h) => (h?.pid as number | undefined) ?? null)
    .catch(() => null);

export function MoveWorkspace() {
  const [status, setStatus] = useState<MoveStatus | null>(null);
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<Written | null>(null);
  const [writeRefused, setWriteRefused] = useState(false);
  const [arriving, setArriving] = useState<{ toEnter: string[]; pid: number | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api("/api/workspace/move")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Taking a workspace in ends this server, the way a restore does: the
  // desktop app relaunches, a browser waits for it to come back.
  useEffect(() => {
    if (!arriving) return;
    let done = false;
    void (async () => {
      await new Promise((r) => setTimeout(r, 2_000));
      if (window.bloks?.relaunch) {
        await window.bloks.relaunch();
        return;
      }
      for (let waited = 0; waited < 120_000 && !done; waited += 1_500) {
        await new Promise((r) => setTimeout(r, 1_500));
        const pid = await serverPid();
        if (pid && pid !== arriving.pid) {
          location.reload();
          return;
        }
      }
      if (!done) setNote("The workspace is in place once Bloks restarts. Restart it to finish.");
    })();
    return () => {
      done = true;
    };
  }, [arriving]);

  if (!status) return null;
  const canWrite = status.canWrite !== false && !writeRefused;
  if (!canWrite && !status.empty) return null;

  const write = () => {
    setWriting(true);
    api("/api/workspace/move", { method: "POST", body: "{}" })
      .then(({ backup, toEnter }: { backup: { name: string }; toEnter: string[] }) => setWritten({ name: backup.name, toEnter }))
      .catch((e: Error & { status?: number }) => {
        if (e.status === 403) setWriteRefused(true);
        else toast.error(e.message);
      })
      .finally(() => setWriting(false));
  };

  const reveal = (name: string) => {
    api(`/api/backups/${encodeURIComponent(name)}/reveal`, { method: "POST" }).catch((e: Error) => toast.error(e.message));
  };

  const take = async (file: File) => {
    const ok = await confirm({
      title: "Bring this workspace here?",
      body: `${file.name} becomes this workspace: its agents, conversations, rooms, routines, memory, skills and settings. Bloks restarts to put it in place. Keys are not in the file, so you enter them again afterwards.`,
      confirmLabel: "Bring it here",
    });
    if (!ok) return;
    setSending(true);
    const pid = await serverPid();
    try {
      const res = await fetch("/api/workspace/move/import", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setArriving({ toEnter: Array.isArray(body.toEnter) ? body.toEnter : [], pid });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const showIn = deviceWord() === "Mac" ? "Show in Finder" : "Show in folder";

  return (
    <SettingsGroup title="Move to a hosted workspace">
      {canWrite && (
        <SettingRow
          label="Write out this workspace"
          info="One file with every agent, conversation, room, routine, watcher, intent, memory, skill and setting. Left out: saved keys, folders on this computer, engine sessions only this computer can carry on, and the Undo history."
          description="One file to bring into a hosted workspace. Keys stay here."
          control={
            <Button size="sm" variant="secondary" disabled={writing} onClick={write}>
              {writing && <Loader2 size={14} className="animate-spin" />}
              Write the file
            </Button>
          }
        >
          {written && (
            <div className="mt-3 rounded-xl bg-muted/60 px-3 py-2.5 text-small leading-relaxed text-muted-foreground">
              <div className="break-all font-medium text-foreground">{written.name}</div>
              <div className="mt-1 text-pretty">{keysToEnter(written.toEnter)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" asChild>
                  <a href={`/api/workspace/move/${encodeURIComponent(written.name)}`} download={written.name}>
                    <Download size={14} />
                    Download
                  </a>
                </Button>
                {window.bloks && (
                  <Button size="sm" variant="ghost" onClick={() => reveal(written.name)}>
                    <FolderOpen size={14} />
                    {showIn}
                  </Button>
                )}
              </div>
            </div>
          )}
        </SettingRow>
      )}
      {status.empty && (
        <SettingRow
          label="Bring a workspace here"
          description={
            status.hosted
              ? "This hosted workspace is empty. Bring in the file you wrote out on your Mac."
              : "This workspace is empty, so it can take in a workspace written out elsewhere."
          }
          control={
            <>
              <input
                ref={picker}
                type="file"
                accept=".gz,.enc,application/gzip,application/octet-stream"
                className="sr-only"
                aria-label="Workspace file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void take(file);
                }}
              />
              <Button size="sm" variant="secondary" disabled={sending || Boolean(arriving)} onClick={() => picker.current?.click()}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Choose the file
              </Button>
            </>
          }
        >
          {arriving && (
            <div role="status" className="mt-3 rounded-xl bg-muted/60 px-3 py-2.5 text-small leading-relaxed text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                {!note && <Loader2 size={13} className="animate-spin" />}
                {note ?? "Putting the workspace in place. Bloks restarts in a moment."}
              </div>
              <div className="mt-1 text-pretty">{keysToEnter(arriving.toEnter)}</div>
            </div>
          )}
        </SettingRow>
      )}
    </SettingsGroup>
  );
}
