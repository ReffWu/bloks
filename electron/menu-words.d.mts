// Hand-written twin of menu-words.mjs, for the tests.

export type MenuWords = (key: string, params?: Record<string, string | number>) => string;

export function menuLanguage(choice: string | null | undefined, systemTags?: readonly string[]): string;
export function menuWords(dir: string, code: string): MenuWords;
