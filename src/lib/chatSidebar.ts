// How wide the chat's own sidebar is, and whether it is open. Kept on this
// device, like the old rail choice: how much list you want in view depends
// on the screen, not on the workspace. The title bar's toggle and ⌘B fold
// it; dragging its edge sizes it, and dragging it narrow enough folds it.
//
// It is one of the page columns (lib/sideColumn.ts), the first of them,
// so its sizes and its keys are the ones the others were modelled on.
import { CHAT_COLUMN, CHAT_SIZE, useSideColumn, type SideColumnState } from "./sideColumn.ts";

export const CHAT_SIDEBAR = CHAT_SIZE;

export function useChatSidebar(): SideColumnState {
  return useSideColumn(CHAT_COLUMN, CHAT_SIDEBAR);
}
