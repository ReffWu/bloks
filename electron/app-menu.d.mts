// Hand-written twin of app-menu.mjs, so the tests typecheck against the
// same shape the main process builds its menu from.

export type TabCommand = "newConversation" | "closeConversation" | "previousConversation" | "nextConversation";

export type MenuCommand = "settings" | "shortcuts" | TabCommand;

export const TAB_COMMANDS: readonly TabCommand[];

export interface MenuTemplateItem {
  label?: string;
  role?: string;
  type?: "separator";
  accelerator?: string;
  click?: () => void;
  submenu?: MenuTemplateItem[];
}

export function appMenuTemplate(options: {
  name: string;
  packaged: boolean;
  command: (word: MenuCommand) => void;
  /** Each label in the person's language (electron/menu-words.mjs). */
  words: (key: string, params?: Record<string, string>) => string;
}): MenuTemplateItem[];
