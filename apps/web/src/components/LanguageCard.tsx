import { useId } from "react";
import {
  Card,
  CardContent,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "@eventer/shared/i18n";
import { useLanguageChoice } from "../i18n/useLanguageChoice.js";
import type { LanguageChoice } from "../i18n/languagePreference.js";

/** 選べる値。先頭が「自動」で、あとは対応言語の並びそのまま */
const OPTIONS: readonly LanguageChoice[] = ["auto", ...SUPPORTED_LANGUAGES];

/**
 * 呼び名は書いたままの綴りで出す。MUI 既定の大文字化だと `ENGLISH` と `日本語`
 * が並んで不揃いになるうえ、言語の呼び名の綴りを勝手に変えることになる。
 */
const KEEP_SPELLING = { textTransform: "none" } as const;

/**
 * アカウント設定: 表示言語 (#354)。
 *
 * 選べるのは「自動」＋対応言語。**対応言語の並びは `SUPPORTED_LANGUAGES` が
 * 出所**なので、言語を足すときにこの画面を触る必要はない。
 */
export function LanguageCard() {
  const { t } = useTranslation();
  const [choice, setChoice] = useLanguageChoice();
  // 見出しと補足を読み上げに紐付ける。aria-label で同じ文言を書くと
  // 見出しと合わせて2回読まれるため、id で参照する
  const titleId = useId();
  const hintId = useId();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography id={titleId} variant="h6" gutterBottom>
          {t("settings.languageTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.languageDescription")}
        </Typography>
        <Stack spacing={1} alignItems="flex-start">
          <ToggleButtonGroup
            size="small"
            exclusive
            value={choice}
            onChange={(_e, v: LanguageChoice | null) => {
              // 選択中のボタンをもう一度押すと null が来る。解除はさせない
              if (v != null) setChoice(v);
            }}
            aria-labelledby={titleId}
            aria-describedby={hintId}
          >
            {OPTIONS.map((option) => (
              <ToggleButton
                key={option}
                value={option}
                // 言語の呼び名には lang を付けて、読み上げがその言語の発音で
                // 読むようにする（「自動」は画面の言語のままでよい）
                lang={option === "auto" ? undefined : option}
                sx={KEEP_SPELLING}
              >
                {option === "auto"
                  ? t("settings.languageAuto")
                  : LANGUAGE_NAMES[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography id={hintId} variant="caption" color="text.secondary">
            {t("settings.languageAutoDescription")}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
