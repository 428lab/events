import { useState } from "react";
import { Box, Button, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";

/**
 * Bluesky のハンドルを聞いて認可を始めるフォーム (#381)。
 *
 * **素の `<form method="get">`**。fetch で叩くと外部の許可画面へ行けない
 * （トップレベル遷移でないと戻ってこられない）ので、ここは JavaScript で
 * 送信を横取りしない。押した先の判断（ログインか連携か）はサーバーが
 * 「セッションがあるか」だけで決めるため、ログイン画面とアカウント設定で
 * **同じ URL・同じ部品**を使う。
 */
export const BLUESKY_LOGIN_PATH = "/api/auth/bluesky/login";

/**
 * 入力の補助。前後の空白を落とし、先頭の `@` を落とし、小文字化する。
 *
 * 空白は途中に入っていても落とす（貼り付けで混ざるため。ハンドルに空白は
 * 使えないので取り除いて困らない）。**妥当性の判定はしない**——通す/通さないの
 * 契約はサーバー側の1か所（`normalizeBlueskyHandle`）にあり、ここで正規表現を
 * 書くと同じ契約が2か所になる。ここがやるのは「打ち間違いを直す」ことだけ。
 */
export function normalizeHandleInput(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/^@+/, "").toLowerCase();
}

export function BlueskyHandleForm({
  submitLabel,
  next,
  compact = false,
  autoFocus = false,
}: {
  /** 送信ボタンの文言（ログイン画面と設定画面で違う） */
  submitLabel: string;
  /** ログイン後の戻り先。自サイト内のパスだけを渡すこと（サーバーも再確認する） */
  next?: string | null;
  /** 連携の一覧に差し込むときの詰めた見た目（ログイン画面は false） */
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState("");

  return (
    <Box
      component="form"
      method="get"
      action={BLUESKY_LOGIN_PATH}
      sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%" }}
    >
      <TextField
        name="handle"
        size="small"
        fullWidth
        autoFocus={autoFocus}
        label={t("login.blueskyHandleLabel")}
        placeholder={t("login.blueskyHandlePlaceholder")}
        helperText={t("login.blueskyHandleHelp")}
        value={handle}
        onChange={(e) => setHandle(normalizeHandleInput(e.target.value))}
        slotProps={{
          htmlInput: {
            autoCapitalize: "none",
            autoCorrect: "off",
            spellCheck: false,
            inputMode: "url",
          },
        }}
      />
      {next && <input type="hidden" name="next" value={next} />}
      <Button
        type="submit"
        variant="contained"
        size={compact ? "small" : "large"}
        // 空のまま送ってもサーバーが 400 を返すだけなので、押させない
        disabled={handle.length === 0}
        sx={{ alignSelf: compact ? "flex-end" : "stretch" }}
      >
        {submitLabel}
      </Button>
    </Box>
  );
}
