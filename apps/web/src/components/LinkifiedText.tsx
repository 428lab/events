import { Link } from "@mui/material";
import { splitByUrls } from "@eventer/shared";

/**
 * テキスト中の URL を新しいタブで開くリンクにして描画する (#444 フォローアップ)。
 *
 * - 分割の契約は **shared の `splitByUrls` を共用**（チャット #241 と同じ。
 *   http/https だけをリンク化し、javascript: 等はテキストのまま——判定の
 *   写しをここに作らない）
 * - React のテキストノードで組む（dangerouslySetInnerHTML は使わない）。
 *   リンク化は表示時だけで、保存データは変えない
 * - 改行の保持は呼び出し側の Typography（whiteSpace: pre-wrap）が担う
 */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitByUrls(text).map((tok, i) =>
        tok.type === "text" ? (
          <span key={i}>{tok.value}</span>
        ) : (
          <Link
            key={i}
            href={tok.value}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ wordBreak: "break-all" }}
          >
            {tok.value}
          </Link>
        ),
      )}
    </>
  );
}
