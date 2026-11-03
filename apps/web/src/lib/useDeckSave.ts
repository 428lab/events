import { useEffect, useRef, useState } from "react";
import type { DeckContent } from "@eventer/shared";
import { ApiError } from "../api/client.js";
interface Snapshot { title: string; content: DeckContent; revision: number }

/** 409 の当て直しの間隔（docs/team-deck-live-sync.md §7.6）。この回数を超えたら今の案内に戻る */
const REBASE_BACKOFF_MS = [500, 1000, 2000];

const isConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && (error.body as { error?: string } | null)?.error === "deck_conflict";

export interface DeckSaveOptions {
  /**
   * 409 deck_conflict のとき、取り直した中身と手元を合わせる（同時編集が有効なチームのスライドだけ）。
   * 合わせた中身を画面へ入れ（acceptRemote を通す）、合わせられなければ null を返す（今の案内に戻る）
   */
  rebase?: () => Promise<unknown | null>;
}

/** Deck-only single-flight autosave. Failed snapshots remain queued until explicit retry. */
export function useDeckSave(
  title: string,
  content: DeckContent | null,
  save: (value: { title: string; content: DeckContent }) => Promise<unknown>,
  options: DeckSaveOptions = {},
) {
  const latest = useRef<Snapshot | null>(null);
  const ack = useRef<Snapshot | null>(null);
  const inFlight = useRef(false);
  const failed = useRef(false);
  /** 失敗した理由（409 deck_conflict なら、ほかの人が保存していた。編集画面が見分ける） */
  const lastError = useRef<unknown>(null);
  const mounted = useRef(true);
  const sendFn = useRef(save); sendFn.current = save;
  const rebaseFn = useRef(options.rebase); rebaseFn.current = options.rebase;
  /** 続けて 409 を当て直した回数（保存できたら 0 に戻す） */
  const rebases = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [, render] = useState(0);
  const notify = () => { if (mounted.current) render((n) => n + 1); };
  async function send() {
    if (!latest.current || inFlight.current || failed.current || latest.current === ack.current) return;
    const snapshot = latest.current;
    inFlight.current = true; notify();
    let again = false;
    try {
      await sendFn.current({ title: snapshot.title, content: snapshot.content });
      ack.current = snapshot;
      rebases.current = 0;
    } catch (error) {
      const rebase = rebaseFn.current;
      if (rebase && isConflict(error) && rebases.current < REBASE_BACKOFF_MS.length) {
        // キューは残したまま、取り直した中身と合わせて送り直す（今の reset は使わない）
        const wait = REBASE_BACKOFF_MS[rebases.current++];
        await new Promise((r) => setTimeout(r, wait));
        // 合わせた中身は rebase の中で acceptRemote を通って latest に入っている
        const merged = mounted.current ? await rebase().catch(() => null) : null;
        if (merged) {
          again = true;
        } else {
          failed.current = true; lastError.current = error;
        }
      } else {
        failed.current = true; lastError.current = error;
      }
    }
    finally {
      inFlight.current = false; notify();
      if (mounted.current && !failed.current && (again || latest.current !== ack.current)) void send();
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (!content) return;
    if (!latest.current) { latest.current = ack.current = { title, content, revision: 0 }; notify(); return; }
    if (latest.current.title === title && latest.current.content === content) return;
    latest.current = { title, content, revision: latest.current.revision + 1 };
    clearTimeout(timer.current);
    if (!failed.current) timer.current = setTimeout(() => void send(), 800);
    notify();
    return () => clearTimeout(timer.current);
  }, [title, content]);
  const saved = content !== null && ack.current === latest.current && ack.current?.content === content && ack.current.title === title;
  return {
    saved,
    status: failed.current ? "editorFailed" as const : inFlight.current ? "editorSaving" as const : saved ? "editorSaved" as const : "unsaved" as const,
    revision: latest.current?.revision ?? 0, acknowledgedRevision: ack.current?.revision ?? 0,
    error: failed.current ? lastError.current : null,
    retry: () => { failed.current = false; lastError.current = null; rebases.current = 0; clearTimeout(timer.current); void send(); },
    /** 読み込み直した中身を「保存済み」として受け取る（それ自体は保存しない）。
     * 呼んだあとに同じ title・content を state へ入れること */
    reset: (nextTitle: string, nextContent: DeckContent) => {
      clearTimeout(timer.current);
      failed.current = false; lastError.current = null;
      latest.current = ack.current = { title: nextTitle, content: nextContent, revision: 0 };
      notify();
    },
    /**
     * ほかの人の変更を当てた中身を受け取る（§7.6）。それだけでは保存しない。
     * state へ入れるのと**同じオブジェクト**を、次の描画より前に渡すこと。
     * 自分の未保存が無ければ保存済みのまま進め、あれば次の保存にほかの人の変更も入れる
     */
    acceptRemote: (nextTitle: string, nextContent: DeckContent) => {
      if (!latest.current) return;
      const clean = latest.current === ack.current;
      latest.current = { title: nextTitle, content: nextContent, revision: latest.current.revision + (clean ? 0 : 1) };
      if (clean) ack.current = latest.current;
      // 中身が変わると上の effect が予約を消すので、未保存があれば予約し直す
      else if (!failed.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void send(), 800);
      }
      notify();
    },
  };
}
