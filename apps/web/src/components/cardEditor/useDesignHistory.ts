import { useReducer } from "react";
import type { CardDesign } from "@eventer/shared";
interface History { past: CardDesign[]; present: CardDesign; future: CardDesign[] }
type Action = { type: "edit" | "reset"; design: CardDesign } | { type: "undo" | "redo" };
export function designHistory(state: History, action: Action): History {
  if (action.type === "reset") return { past: [], present: action.design, future: [] };
  if (action.type === "edit") {
    if (JSON.stringify(action.design) === JSON.stringify(state.present)) return state;
    return { past: [...state.past, state.present].slice(-30), present: action.design, future: [] };
  }
  if (action.type === "undo" && state.past.length) return {
    past: state.past.slice(0, -1), present: state.past[state.past.length - 1]!, future: [state.present, ...state.future],
  };
  if (action.type === "redo" && state.future.length) return {
    past: [...state.past, state.present], present: state.future[0]!, future: state.future.slice(1),
  };
  return state;
}
export function useDesignHistory(initial: CardDesign) {
  const [state, dispatch] = useReducer(designHistory, { past: [], present: initial, future: [] });
  return { design: state.present, canUndo: Boolean(state.past.length), canRedo: Boolean(state.future.length),
    edit: (design: CardDesign) => dispatch({ type: "edit", design }),
    reset: (design: CardDesign) => dispatch({ type: "reset", design }),
    undo: () => dispatch({ type: "undo" }), redo: () => dispatch({ type: "redo" }) };
}
