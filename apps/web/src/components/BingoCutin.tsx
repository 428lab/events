import { Avatar, Box, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { BingoStatusRow } from "@eventer/shared";
import type { BingoCutin as BingoCutinState } from "../lib/useBingoScreenEffects.js";
import { BOARD_ACCENT, BOARD_BG, BOARD_TEXT } from "./MeetRanking.js";

/** 紙吹雪の粒（CSS だけ。ライブラリは足さない）。位置・色・遅れは固定の並び */
const CONFETTI = Array.from({ length: 28 }, (_v, i) => ({
  left: (i * 37) % 100,
  delay: (i % 7) * 0.12,
  color: ["#2DD4BF", "#FBBF24", "#F472B6", "#60A5FA", "#EAF0F7"][i % 5],
  rotate: (i * 53) % 360,
}));

/**
 * ビンゴの投影のカットイン (#681 PR3)。人数が増えたら全画面に「ビンゴ！」と「n人目」
 * （同時なら「n人同時」）を出す。名前は staff で開いた投影だけ（`names` が空なら人数のみ）。
 * 時間は `useBingoScreenEffects` が持ち、ここは描画だけ。reduced では帯・紙吹雪を動かさない。
 */
export function BingoCutin({
  cutin,
  names,
  reduced,
}: {
  cutin: BingoCutinState;
  names: BingoStatusRow[];
  reduced: boolean;
}) {
  const { t } = useTranslation();
  const line =
    cutin.n > 1
      ? t("eventSocial.bingoCutinTie", { n: cutin.n })
      : t("eventSocial.bingoCutinNth", { n: cutin.total });
  return (
    <Box
      key={cutin.key}
      role="status"
      aria-label={`${t("eventSocial.bingoBingo")} ${line}`}
      data-testid="bingo-cutin"
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        overflow: "hidden",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: `${BOARD_BG}cc`,
        "@keyframes bingoCutinBand": {
          "0%": { transform: "translateX(-120%) rotate(-8deg)" },
          "18%,82%": { transform: "translateX(0) rotate(-8deg)" },
          "100%": { transform: "translateX(120%) rotate(-8deg)" },
        },
        "@keyframes bingoCutinWords": {
          "0%,12%": { opacity: 0, transform: "scale(1.4)" },
          "22%,85%": { opacity: 1, transform: "scale(1)" },
          "100%": { opacity: 0, transform: "scale(1)" },
        },
        "@keyframes bingoConfetti": {
          "0%": { transform: "translateY(-10vh) rotate(0deg)", opacity: 1 },
          "100%": { transform: "translateY(110vh) rotate(540deg)", opacity: 0.6 },
        },
      }}
    >
      <Box
        data-testid="bingo-cutin-band"
        sx={{
          position: "absolute",
          left: "-10%",
          right: "-10%",
          top: "22%",
          bottom: "16%",
          background: `linear-gradient(100deg, ${BOARD_ACCENT}, #0EA5E9 55%, ${BOARD_ACCENT})`,
          boxShadow: `0 0 60px ${BOARD_ACCENT}88`,
          transform: "rotate(-8deg)",
          animation: reduced ? undefined : "bingoCutinBand 4s cubic-bezier(.2,.7,.2,1) both",
        }}
      />
      {!reduced &&
        CONFETTI.map((c, i) => (
          <Box
            key={i}
            aria-hidden
            sx={{
              position: "absolute",
              top: 0,
              left: `${c.left}%`,
              width: 12,
              height: 18,
              bgcolor: c.color,
              borderRadius: "2px",
              transform: `rotate(${c.rotate}deg)`,
              animation: `bingoConfetti 2.6s ${c.delay}s ease-in both`,
            }}
          />
        ))}
      <Stack
        alignItems="center"
        spacing={1.5}
        sx={{
          position: "relative",
          textAlign: "center",
          px: 3,
          animation: reduced ? undefined : "bingoCutinWords 4s ease both",
        }}
      >
        <Typography
          sx={{
            fontSize: "clamp(64px, 14vw, 200px)",
            fontWeight: 900,
            lineHeight: 1,
            color: BOARD_BG,
            textShadow: "0 4px 0 #ffffff55",
          }}
        >
          {t("eventSocial.bingoBingo")}
        </Typography>
        <Typography sx={{ fontSize: "clamp(24px, 4.5vw, 64px)", fontWeight: 800, color: BOARD_BG }}>
          {line}
        </Typography>
        {names.length > 0 && (
          <Stack
            direction="row"
            spacing={3}
            flexWrap="wrap"
            useFlexGap
            justifyContent="center"
            data-testid="bingo-cutin-names"
            sx={{ pt: 1 }}
          >
            {names.map((row) => (
              <Stack
                key={row.userId}
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ bgcolor: `${BOARD_BG}e6`, borderRadius: 999, pl: 1, pr: 3, py: 0.75 }}
              >
                <Avatar
                  src={row.avatarUrl ?? undefined}
                  sx={{ width: "clamp(40px, 5vw, 72px)", height: "clamp(40px, 5vw, 72px)", border: `3px solid ${BOARD_TEXT}` }}
                >
                  {row.name.charAt(0)}
                </Avatar>
                <Typography sx={{ fontSize: "clamp(22px, 4vw, 56px)", fontWeight: 800, color: BOARD_TEXT }}>
                  {row.name}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
