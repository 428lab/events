/** ハンドル（プロフィールURL）の自動生成 (#236)。
 * ハンドル概念のないプロバイダ（Google等）では表示名やメールから作る。 */

/** 許可文字に整形したハンドル候補を返す。2文字未満に痩せる場合は null。
 * 連番付与（availableUsername）の余地を残すため28文字で切る */
export function sanitizeHandle(desired: string | null | undefined): string | null {
  if (!desired) return null;
  const cleaned = desired
    .replace(/[^A-Za-z0-9_.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28)
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/** 表示名 → メールの@前 → "user" の順でハンドル候補を決める */
export function deriveHandle(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return (
    sanitizeHandle(name) ??
    sanitizeHandle(email ? email.split("@")[0] : null) ??
    "user"
  );
}
