// The shapes an agent's interface answer can take, as the app reads them.
//
// One library, one place: the definitions live beside the server
// (server/genui-library.ts), which writes the prompt from them and checks
// what an agent wrote against them before keeping it. They hold no React
// and nothing from Node, so the app reads the very same ones here and
// pairs each with a renderer (src/components/genui/library.tsx). A shape
// changed there is changed in the prompt, the check and the chat at once.
export {
  GENUI_GROUPS,
  GENUI_NAMES,
  GENUI_ROOT,
  GENUI_SHAPES,
  isOpenUiLang,
  openUiFences,
  type GenUiShapeName,
} from "../../../server/genui-library.ts";
