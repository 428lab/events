import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { UserProfile } from "@eventer/shared";
import { LicenseCardSvg } from "./LicenseCardSvg.js";
import { toCardData } from "./cardData.js";
import { cardLook } from "./cardLook.js";

/** カードの表示幅の上限。名刺なので大きすぎると画面を占領する。
 * 幅が足りないときは 91×55mm の比率のまま縮む（SVGなので文字も一緒に縮む） */
const CARD_MAX_W = 640;

/**
 * プロフィールの先頭に置くカード (#334)。
 *
 * カードは名刺のように「見せて渡す」もので、QRの飛び先がこのプロフィール。
 * だからカードを主役にして最初に見せ、カードに載っている情報（アイコン・名前・
 * ハンドル・レベル・バッジ・所属コミュニティ）はこの下で繰り返さない。
 *
 * 描くのは**必ず持ち主が決めた見た目**で、アプリのテーマにも見ている人の設定にも
 * 左右されない（見ている人の既定は、持ち主が一度も決めていないときだけ借りる）。
 * 編集・印刷・書き出しはデザイン画面（本人だけ）にあるので、ここには持たない。
 */
export function ProfileCardPanel({
  profile,
  fallbackHandle,
}: {
  profile: UserProfile;
  /** URLで指定されたハンドル（プロフィールが handle を持たない古い応答の保険） */
  fallbackHandle: string;
}) {
  const { t } = useTranslation();
  const handle = profile.handle ?? fallbackHandle;
  const card = toCardData(profile, fallbackHandle, window.location.host);
  const look = cardLook(profile.cardImageKey);
  // QRの飛び先は公開プロフィール。?ref=card は流入元の集計用（許可リスト登録済み）
  const qrUrl = `${window.location.origin}/users/${handle}?ref=card`;

  return (
    <Box sx={{ maxWidth: CARD_MAX_W }}>
      {/* カードの中の文字はSVGで、支援技術からは読めない（role="img"）。
          誰のページかを言葉でも示すために名前の見出しを置く */}
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {profile.name}
      </Typography>
      <Box
        sx={{
          borderRadius: "20px",
          // カード自体が薄色なのでダークテーマでも浮くよう影をつける
          boxShadow: 3,
          overflow: "hidden",
        }}
      >
        <LicenseCardSvg
          card={card}
          variant={look.variant}
          theme={look.theme}
          qrUrl={qrUrl}
        />
      </Box>
      {/* 見る側で言い分ける。印刷や書き出しの案内は本人にしか意味がない */}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.75 }}
      >
        {profile.isMe
          ? t("profile.cardOwnHint")
          : t("profile.cardOtherHint")}
      </Typography>
    </Box>
  );
}
