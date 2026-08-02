import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/** デプロイ後の古いバンドルを検知し、次のページ遷移で自動リロードする (#143)。
 * 入力中のフォームを失わないよう、検知即リロードはせず遷移タイミングでのみ行う。
 * チェックは5分間隔＋タブ復帰時。オフライン等の失敗は無視。 */
export function useBundleReload() {
  const stale = useRef(false);
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (version && version !== __APP_VERSION__) stale.current = true;
      } catch {
        /* オフライン等は無視 */
      }
    };
    const iv = setInterval(check, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (stale.current) window.location.reload();
  }, [location.pathname]);
}
