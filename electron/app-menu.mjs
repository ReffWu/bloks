// The macOS menu bar.
//
// Electron's stock menu served until the app wanted one item of its own:
// Settings…, with ⌘, beside it, where every Mac app keeps it. A menu bar
// is replaced whole or not at all, so this is the stock menu written out
// item for item, with that one addition and a Help menu that says
// something about this app instead of linking to Electron's website.
//
// Two things are kept off it on purpose. No item takes a key the window
// already answers to (⌘K, ⌘N, ⌘F, ⌘/, ⌘↩ and the rest in
// src/lib/shortcuts.ts): a menu key equivalent is heard before the page,
// and a menu that took one of those would quietly break it. And Reload and
// the developer tools appear only in a build run from source, the same
// rule the window keeps on Windows and Linux: they are for working on the
// app, and an installed one has no use for them.
//
// The conversation tabs' keys are the exception, because a Mac lists a
// tab's keys in its menus (GitHub 401): New Conversation ⌘T and Close
// Conversation ⌘W under File, the window's Close moved to ⌘⇧W beside
// them, and Previous and Next Conversation ⌘⇧[ and ⌘⇧] under Window.
// These choices are played to the page as the keys they name
// (src/lib/conversationKeys.ts), so the page's own rules still decide
// what each press does, the terminal's tabs and a dialog's included,
// whichever of the two hears the key first.
//
// Built by a function with no Electron in it, so a test can read the
// template without starting the app. The roles bring their own labels and
// keys (⌘Z, ⌘C, ⌘Q and so on), exactly as the stock menu had them.

/** The menu's words for the conversation tabs, carried to the window in
 * front rather than to the workspace's (electron/main.mjs). */
export const TAB_COMMANDS = ["newConversation", "closeConversation", "previousConversation", "nextConversation"];

/**
 * @param {{ name: string; packaged: boolean; command: (word: "settings" | "shortcuts" | (typeof TAB_COMMANDS)[number]) => void }} options
 *   `command` carries a menu choice to the window it is for.
 */
export function appMenuTemplate({ name, packaged, command }) {
  return [
    {
      // macOS names this menu after the app whatever the label says
      label: name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => command("settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Conversation", accelerator: "CmdOrCtrl+T", click: () => command("newConversation") },
        { type: "separator" },
        { label: "Close Conversation", accelerator: "CmdOrCtrl+W", click: () => command("closeConversation") },
        // the stock ⌘W, moved aside the way a browser's Close Window is
        { role: "close", accelerator: "CmdOrCtrl+Shift+W" },
      ],
    },
    {
      // Copy and paste in every text field live here: on a Mac the
      // keys are the menu's, and without these items they do nothing.
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(packaged
          ? []
          : [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }]),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      // the window role is what makes macOS list the open windows here
      role: "window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { label: "Previous Conversation", accelerator: "CmdOrCtrl+Shift+[", click: () => command("previousConversation") },
        { label: "Next Conversation", accelerator: "CmdOrCtrl+Shift+]", click: () => command("nextConversation") },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      // No key here: ⌘/ belongs to the window, which also has to hear it
      // in a browser and on Windows and Linux, where there is no menu.
      role: "help",
      submenu: [{ label: "Keyboard Shortcuts", click: () => command("shortcuts") }],
    },
  ];
}
