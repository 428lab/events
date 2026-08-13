import { safeRedirectPath as safePathFor } from "@eventer/shared";

/**
 * ログイン後の戻り先（`/login?next=…`）として安全なパスだけを通す。
 *
 * **規則そのものは `@eventer/shared` にある。** サーバー側（Bluesky の
 * コールバック）も同じ関数を通すので、片方だけ緩くならない (#381)。
 * ここは自分のオリジンを渡すだけの薄い包み。
 */
export function safeRedirectPath(next: string | null | undefined): string | null {
  return safePathFor(next, window.location.origin);
}
