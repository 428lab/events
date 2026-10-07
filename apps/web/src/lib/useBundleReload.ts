import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/** デプロイ後の古いバンドルを検知して自動リロードする (#143)。
 * 入力中のフォームを失わないよう、リロードはページ遷移のタイミングでのみ行う。
 * - タブ復帰時にチェック（検知したら次の遷移でリロード）。定期のチェックはしない
 *   （D-POLL-MIN。リロードするのはどのみち遷移のときだけなので、遷移と復帰で足りる）
 * - さらに毎回の遷移時にもチェックし、古ければその場でリロード
 *   （遷移直後は入力が無い安全なタイミングなので即リロードしてよい）
 * オフライン等の失敗は無視。 */
export function useBundleReload() {
  const stale = useRef(false);
  const location = useLocation();

  const check = async (): Promise<boolean> => {
    try {
      const res = await fetch(`/version.json?ts=${Date.now()}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return false;
      const { version } = (await res.json()) as { version?: string };
      if (version && version !== __APP_VERSION__) {
        stale.current = true;
        return true;
      }
    } catch {
      /* オフライン等は無視 */
    }
    return false;
  };

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 遷移時: 既に検知済みなら即リロード。未検知でもその場でチェックして古ければリロード
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (stale.current) {
      window.location.reload();
      return;
    }
    void check().then((isStale) => {
      if (isStale) window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}
