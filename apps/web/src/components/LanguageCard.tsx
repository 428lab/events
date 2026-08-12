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
            <ToggleButton value="auto">{t("settings.languageAuto")}</ToggleButton>
            {SUPPORTED_LANGUAGES.map((lang) => (
              // lang 属性を付けて、読み上げがその言語の発音で読むようにする
              <ToggleButton key={lang} value={lang} lang={lang}>
                {LANGUAGE_NAMES[lang]}
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
