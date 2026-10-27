// A tab of the Bloks browser with no Electron behind it: a fake
// webContents.debugger that answers the protocol calls the app makes
// (electron/app-browser.mjs runOnTab) from a page described as data, and
// writes down every call, so a test can say what a command did to a page.
import type { AxNode, TabHandle } from "../../electron/app-browser.mjs";

export interface FakeElement {
  backendNodeId: number;
  role: string;
  name: string;
  nodeName?: string;
  attributes?: Record<string, string>;
  /** What is really at its middle, when something covers it. */
  coveredBy?: string;
  options?: string[];
  value?: string;
}

export interface FakePage {
  url: string;
  title: string;
  text?: string;
  elements: FakeElement[];
}

export interface FakeTab extends TabHandle {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  pages: Record<string, FakePage>;
  current: FakePage;
  /** Text that shows up after this many checks of a wait. */
  appearsAfter?: { text: string; checks: number };
}

const BLANK: FakePage = { url: "about:blank", title: "", elements: [] };

export function axTree(page: FakePage): AxNode[] {
  return [
    { nodeId: "root", role: { value: "RootWebArea" }, name: { value: page.title }, childIds: page.elements.map((e) => `n${e.backendNodeId}`), backendDOMNodeId: 1 },
    ...page.elements.map((e) => ({
      nodeId: `n${e.backendNodeId}`,
      parentId: "root",
      role: { value: e.role },
      name: { value: e.name },
      ...(e.value !== undefined ? { value: { value: e.value } } : {}),
      backendDOMNodeId: e.backendNodeId,
    })),
  ];
}

/** A tab whose pages are `pages`, by address. */
export function fakeTab(pages: Record<string, FakePage> = {}): FakeTab {
  let checks = 0;
  const tab: FakeTab = {
    calls: [],
    pages,
    current: BLANK,
    pollMs: 1,
    url: () => tab.current.url,
    title: () => tab.current.title,
    load: (url) => {
      tab.current = pages[url] ?? { ...BLANK, url };
    },
    loading: () => false,
    canGoBack: () => false,
    canGoForward: () => false,
    close: () => {},
    async cdp(method, params = {}) {
      tab.calls.push({ method, params });
      const element = (id: unknown) => tab.current.elements.find((e) => e.backendNodeId === id);
      switch (method) {
        case "Page.navigate":
          tab.current = pages[String(params.url)] ?? { url: String(params.url), title: "", elements: [] };
          return { frameId: "f1" };
        case "Accessibility.getFullAXTree":
          return { nodes: axTree(tab.current) };
        case "Runtime.evaluate": {
          const expression = String(params.expression);
          if (expression.includes("MutationObserver")) return { result: { value: true } };
          if (expression.includes("cloneNode")) return { result: { value: tab.current.text ?? "" } };
          if (expression.includes("includes(")) {
            const want = JSON.parse(expression.match(/includes\(("(?:[^"\\]|\\.)*")\)/)![1]);
            checks++;
            const shown = tab.appearsAfter && checks >= tab.appearsAfter.checks ? `${tab.current.text ?? ""} ${tab.appearsAfter.text}` : (tab.current.text ?? "");
            const found = shown.includes(want);
            return { result: { value: expression.startsWith("!") ? !found : found } };
          }
          if (expression.includes("readyState")) return { result: { value: true } };
          return { result: { value: 50 } };
        }
        case "DOM.describeNode": {
          const found = element(params.backendNodeId);
          const attrs = Object.entries(found?.attributes ?? {}).flat();
          return { node: { nodeName: (found?.nodeName ?? "BUTTON").toUpperCase(), attributes: attrs } };
        }
        case "DOM.resolveNode":
          return element(params.backendNodeId) ? { object: { objectId: `o${params.backendNodeId}` } } : {};
        case "DOM.getBoxModel":
          return { model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } };
        case "Runtime.callFunctionOn": {
          const found = element(Number(String(params.objectId).slice(1)));
          const fn = String(params.functionDeclaration);
          if (fn.includes("elementFromPoint")) return { result: { value: found?.coveredBy ?? null } };
          if (fn.includes("SELECT")) {
            const want = String((params.arguments as Array<{ value: unknown }>)[0].value);
            if (!found?.options) return { result: { value: { error: "not a list to choose from" } } };
            const chose = found.options.find((o) => o.toLowerCase() === want.toLowerCase() || o.toLowerCase().startsWith(want.toLowerCase()));
            return { result: { value: chose ? { chose } : { error: "no such option", options: found.options } } };
          }
          return { result: { value: null } };
        }
        case "Page.getLayoutMetrics":
          return { cssVisualViewport: { clientWidth: 1000, clientHeight: 800 } };
        case "Page.captureScreenshot":
          return { data: "aGVsbG8=" };
        case "Page.getNavigationHistory":
          return { currentIndex: 0, entries: [{ id: 1, url: tab.current.url }] };
        default:
          return {};
      }
    },
  };
  return tab;
}

/** The protocol methods a tab was sent, in order. */
export const methods = (tab: FakeTab) => tab.calls.map((c) => c.method);
