// The workspace you are in, at the top left of the window, and the way to
// the others.
//
// A pill with the workspace's mark and name; its menu lists every
// workspace on this computer (a dot on one that has something waiting, a
// tick on the one you are in), then joining one and making one, then what
// belongs to the one you are in: its settings and its mute. ⌘1 to ⌘9 go
// straight to the first nine, in the menu's order, without opening it.
//
// Switching is the main process pointing the window at another
// workspace's server, which is already running, so the page loads afresh
// and this component is drawn again by the workspace it now shows.
import { useEffect, useRef, useState } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { BellOff, Check, ChevronsUpDown, Loader2, LogIn, Plus, RefreshCw, Settings } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { platformOf } from "@/lib/shortcuts";
import {
  MUTE_CHOICES,
  act,
  currentWorkspace,
  hasWaiting,
  muteLabel,
  openWorkspaceDialog,
  peopleLabel,
  useWorkspaces,
  workspaceForKey,
} from "@/lib/workspaces";
import type { WorkspaceInfo, WorkspacesState } from "@/types/bridge";
import { WorkspaceMark } from "./WorkspaceMark";

/** Goes to another workspace, saying so if it cannot. */
export async function goToWorkspace(id: string) {
  const error = await act(window.bloks?.workspaceSwitch?.(id));
  if (error) toast.error(error);
}

/** ⌘1 to ⌘9 (Ctrl elsewhere): the first nine workspaces. Not while the
 * key has already been taken by what has focus, such as the command
 * palette's own Ctrl+number. */
function useWorkspaceKeys(s: WorkspacesState) {
  useEffect(() => {
    if (!s.available || s.workspaces.length < 2) return;
    const mac = platformOf() === "mac";
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.shiftKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
      if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      const target = workspaceForKey(s, Number(e.key));
      if (!target) return;
      e.preventDefault();
      if (target.id !== s.current) void goToWorkspace(target.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);
}

/** One workspace in the menu: mark, name, then what is true of it. */
function WorkspaceRow({ ws, current, index }: { ws: WorkspaceInfo; current: string; index: number }) {
  const [retrying, setRetrying] = useState(false);
  const here = ws.id === current;
  const failed = ws.status === "failed";
  const starting = ws.status === "starting" || retrying;
  const mod = platformOf() === "mac" ? "⌘" : "Ctrl+";
  return (
    <DropdownMenuPrimitive.RadioItem
      value={ws.id}
      disabled={starting && !here}
      onSelect={(e) => {
        if (!failed) return;
        // a workspace that would not start is tried again from right here,
        // with the menu left open to show how that goes
        e.preventDefault();
        setRetrying(true);
        void act(window.bloks?.workspaceRetry?.(ws.id)).then((error) => {
          setRetrying(false);
          if (error) toast.error(error);
        });
      }}
      className="group/row flex select-none items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-ui font-medium text-foreground outline-none data-[disabled]:opacity-60 data-[highlighted]:bg-accent"
    >
      <WorkspaceMark mark={ws.mark} logo={ws.logo} size={24} />
      <span className="min-w-0 flex-1 truncate">{ws.name}</span>
      {hasWaiting(ws, current) && (
        <span className="size-1.5 shrink-0 rounded-full bg-brand-ink" role="img" aria-label="Something is waiting" />
      )}
      {ws.mute.muted && !here && <BellOff size={13} className="shrink-0 text-muted-foreground" aria-label="Muted" />}
      {starting ? (
        <span className="flex shrink-0 items-center gap-1.5 text-small font-normal text-muted-foreground">
          <Loader2 size={12} className="animate-spin" />
          Starting
        </span>
      ) : failed ? (
        <span className="flex shrink-0 items-center gap-1 text-small font-normal text-destructive" title={ws.problem ?? undefined}>
          <RefreshCw size={12} />
          Couldn't start
        </span>
      ) : here ? null : (
        <>
          {/* the people count, or its key once you are reaching for one */}
          <span className="shrink-0 text-small font-normal text-muted-foreground group-data-[highlighted]/row:hidden">
            {peopleLabel(ws)}
          </span>
          {index < 9 && (
            <kbd className="hidden shrink-0 font-sans text-small font-normal tabular-nums text-muted-foreground group-data-[highlighted]/row:inline">
              {mod}
              {index + 1}
            </kbd>
          )}
        </>
      )}
      <DropdownMenuPrimitive.ItemIndicator className="flex shrink-0 items-center">
        <Check size={16} strokeWidth={2.4} className="text-foreground" />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function WorkspaceSwitcher({ className, divider = false }: { className?: string; divider?: boolean }) {
  const s = useWorkspaces();
  const toDialog = useRef(false);
  const { dispatch } = useStore();
  useWorkspaceKeys(s);
  const current = currentWorkspace(s);
  if (!s.available || !current) return null;

  const waitingElsewhere = s.workspaces.some((w) => hasWaiting(w, s.current));
  const muted = muteLabel(current.mute);

  const mute = async (choice: string) => {
    const error = await act(window.bloks?.workspaceMute?.(current.id, choice));
    if (error) toast.error(error);
  };

  return (
    <DropdownMenu>
      {divider && <span aria-hidden className="mx-2.5 h-4 w-px shrink-0 bg-border" />}
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${current.name}, switch workspace`}
          className={cn(
            // the height of the bar's own buttons, so it sits in their row
            // as one of them rather than as a heading above them
            "flex h-7 min-w-0 max-w-[200px] items-center gap-1.5 rounded-lg pl-1 pr-1.5 text-body font-medium text-foreground outline-none transition-[background-color,scale] duration-150 ease-out hover:bg-accent focus-visible:bg-accent active:scale-[0.97] data-[state=open]:bg-accent",
            className,
          )}
        >
          <WorkspaceMark mark={current.mark} logo={current.logo} size={18} />
          <span className="min-w-0 truncate">{current.name}</span>
          {current.mute.muted && <BellOff size={12} className="shrink-0 text-muted-foreground" aria-label="Muted" />}
          <span className="relative flex shrink-0">
            <ChevronsUpDown size={12} strokeWidth={2} className="text-muted-foreground" />
            {/* something waiting in another workspace: the dot that says
                look in here, on the one thing that leads there */}
            {waitingElsewhere && (
              <span
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand-ink ring-2 ring-sidebar"
                role="img"
                aria-label="Something is waiting in another workspace"
              />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[300px] rounded-[14px] p-1.5"
        // A dialog opened from here keeps the focus it starts with: the
        // menu handing it back to its button would take it from the field
        // the person is about to type in.
        onCloseAutoFocus={(e) => {
          if (!toDialog.current) return;
          toDialog.current = false;
          e.preventDefault();
        }}
      >
        <DropdownMenuLabel className="px-2.5 pb-1.5 pt-2">Workspaces</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={s.current}
          onValueChange={(id) => {
            const target = s.workspaces.find((w) => w.id === id);
            if (target && target.status !== "failed" && id !== s.current) void goToWorkspace(id);
          }}
        >
          {s.workspaces.map((ws, i) => (
            <WorkspaceRow key={ws.id} ws={ws} current={s.current} index={i} />
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="mx-1 my-1.5" />
        <DropdownMenuItem className="gap-2.5 rounded-[9px] py-2 text-ui font-medium" onSelect={() => {
            toDialog.current = true;
            openWorkspaceDialog("join");
          }}>
          <LogIn />
          Join a workspace
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5 rounded-[9px] py-2 text-ui font-medium" onSelect={() => {
            toDialog.current = true;
            openWorkspaceDialog("new");
          }}>
          <Plus />
          New workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-1 my-1.5" />
        <DropdownMenuItem
          className="gap-2.5 rounded-[9px] py-2 text-ui font-medium"
          onSelect={() => dispatch({ type: "toggleAppSettings", open: true, page: "workspace:general" })}
        >
          <Settings />
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            icon={<BellOff />}
            value={current.mute.muted ? "On" : undefined}
            className="gap-2.5 rounded-[9px] py-2 text-ui font-medium"
          >
            Mute
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-[230px] rounded-[14px] p-1.5">
            {muted && (
              <>
                <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 font-normal">{muted}</DropdownMenuLabel>
                <DropdownMenuItem className="rounded-[9px]" onSelect={() => void mute("off")}>
                  Turn notifications back on
                </DropdownMenuItem>
                <DropdownMenuSeparator className="mx-1 my-1.5" />
              </>
            )}
            {MUTE_CHOICES.map((choice) => (
              <DropdownMenuItem key={choice.id} className="rounded-[9px]" onSelect={() => void mute(choice.id)}>
                {choice.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
