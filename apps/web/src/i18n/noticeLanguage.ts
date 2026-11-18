/**
 * お知らせとメールの言語をサーバーに知らせる (#352)。オーナー決定 2026-11-19（案 A）:
 * 受け取る人が**最後に使った画面の言語**で送る。設定で選んだ言語があれば、そちらが優先。
 *
 * - 画面を開いたとき（ログイン中）: 今の表示言語がサーバーの値と違うときだけ "report" を送る。
 *   同じなら何も送らない（開くたびに書き込まない）。設定で選んだ言語はサーバーが上書きしない
 * - 設定で言語を選んだ: "choose"。「自動」に戻した: "auto"（選んだ印を外し、今の画面の言語にする）
 *
 * 失敗しても画面は変えない（次に開いたときにまた違えば送る）。定期には見張らない。
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from "@eventer/shared/i18n";
import type { LanguageUpdateMode, NoticeLanguage } from "@eventer/shared";
import { api } from "../api/client.js";
import { useNoticeLanguage } from "../api/hooks.js";

export async function sendNoticeLanguage(
  language: AppLanguage,
  mode: LanguageUpdateMode,
): Promise<NoticeLanguage | null> {
  try {
    const res = await api.put<{ noticeLanguage: NoticeLanguage }>("/me/language", { language, mode });
    return res.noticeLanguage;
  } catch {
    return null;
  }
}

/** ログイン中の画面で1回だけ置く（Layout）。表示言語が変わったときも見直す */
export function useReportNoticeLanguage(): void {
  const { i18n } = useTranslation();
  const current = normalizeLanguage(i18n.resolvedLanguage) ?? DEFAULT_LANGUAGE;
  const stored = useNoticeLanguage();
  const qc = useQueryClient();
  const known = stored?.language ?? null;
  const explicit = stored?.explicit ?? false;
  const loaded = stored !== undefined;

  useEffect(() => {
    // 設定で選んだ言語は、画面を開いたときの自動の報告では変えない（サーバーも上書きしない）
    if (!loaded || explicit || known === current) return;
    let cancelled = false;
    void sendNoticeLanguage(current, "report").then((next) => {
      if (cancelled || !next) return;
      // 覚えた値を手元にも写す（同じ報告をもう一度送らない）
      qc.setQueryData(["me"], (old: object | null | undefined) =>
        old ? { ...old, noticeLanguage: next } : old,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, explicit, known, current, qc]);
}
