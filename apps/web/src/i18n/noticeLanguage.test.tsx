import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client.js";
import { i18next } from "./index.js";
import { useReportNoticeLanguage } from "./noticeLanguage.js";
import { useLanguageChoice } from "./useLanguageChoice.js";

/**
 * お知らせとメールの言語をサーバーに知らせる (#352、オーナー決定 2026-11-19 案 A)。
 * 開いたときは「サーバーの値と違うときだけ」報告し、設定で選んだら choose / 自動に戻したら auto を送る。
 */

function wrapper(me: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me);
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const me = (language: string | null, explicit = false) => ({
  user: { id: "u1" }, isAdmin: false, noticeLanguage: { language, explicit },
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("お知らせの言語の報告 (#352)", () => {
  it("開いたとき、今の言語とサーバーの値が違うときだけ report を送る。選んだ言語には送らない", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ noticeLanguage: { language: "ja", explicit: false } });
    // 同じ（日本語）なら送らない
    renderHook(() => useReportNoticeLanguage(), { wrapper: wrapper(me("ja")) });
    // 違う（まだ分からない）なら送る
    renderHook(() => useReportNoticeLanguage(), { wrapper: wrapper(me(null)) });
    // 設定で英語を選んでいる人は、日本語の画面で開いても送らない
    renderHook(() => useReportNoticeLanguage(), { wrapper: wrapper(me("en", true)) });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("/me/language", { language: "ja", mode: "report" });
  });

  it("設定で選ぶと choose、「自動」に戻すと auto を送る", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ noticeLanguage: { language: "en", explicit: true } });
    const { result } = renderHook(() => useLanguageChoice());
    await act(async () => result.current[1]("en"));
    expect(put).toHaveBeenLastCalledWith("/me/language", { language: "en", mode: "choose" });
    await act(async () => result.current[1]("auto"));
    expect(put).toHaveBeenLastCalledWith("/me/language", { language: i18next.language, mode: "auto" });
  });
});
