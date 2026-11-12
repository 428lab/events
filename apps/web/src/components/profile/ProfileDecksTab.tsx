import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ProfileDeck } from "@eventer/shared";
import { useProfileDecks, useSetProfileDeckAuto } from "../../api/deckHooks.js";
import { ensureDeckFonts } from "../../lib/deckFonts.js";
import { formatDateTime } from "../../lib/format.js";
import { SlideStage } from "../SlideStage.js";

/** プロフィールの「スライド」タブ（docs/profile-tabs.md「スライド」）。本人が載せたデッキを
 * 1枚目のサムネ・枚数・表示回数で並べる。本人には「すべて自動で載せる」のスイッチを出す */
export function ProfileDecksTab({ handle, isMe }: { handle: string; isMe: boolean }) {
  const { t } = useTranslation();
  const { data } = useProfileDecks(handle);
  const setAuto = useSetProfileDeckAuto();
  if (!data) return <Typography>{t("common.loading")}</Typography>;
  return (
    <Stack spacing={2}>
      {isMe && (
        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={data.autoShow === true}
                disabled={setAuto.isPending}
                onChange={(e) => setAuto.mutate(e.target.checked)}
              />
            }
            label={t("profile.deckAutoShow")}
          />
          <Typography variant="caption" color="text.secondary" display="block">
            {t("profile.deckAutoShowHelp")}
          </Typography>
        </Box>
      )}
      {data.decks.length === 0 ? (
        isMe && <Typography color="text.secondary">{t("profile.tabEmptyDecksSelf")}</Typography>
      ) : (
        <Box
          component="ul"
          sx={{
            listStyle: "none", p: 0, m: 0, display: "grid", gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
          }}
        >
          {data.decks.map((d) => <ProfileDeckCard key={d.slug} deck={d} />)}
        </Box>
      )}
    </Stack>
  );
}

function ProfileDeckCard({ deck }: { deck: ProfileDeck }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const title = deck.title || t("studio.untitledDeck");

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (deck.firstSlide) ensureDeckFonts({ slides: [deck.firstSlide] });
  }, [deck.firstSlide]);

  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Box
        ref={frame}
        component={RouterLink}
        to={`/d/${deck.slug}`}
        aria-label={t("profile.deckOpen", { title })}
        sx={{ display: "block", width: "100%", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: 1, overflow: "hidden" }}
      >
        {deck.firstSlide && width > 0 && (
          <Box sx={{ pointerEvents: "none" }}>
            <SlideStage slide={deck.firstSlide} width={width} />
          </Box>
        )}
      </Box>
      <Typography
        component={RouterLink}
        to={`/d/${deck.slug}`}
        variant="subtitle2"
        sx={{ display: "block", mt: 1, overflowWrap: "anywhere", color: "inherit", textDecoration: "none" }}
      >
        {title}
      </Typography>
      {deck.team && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: "anywhere" }}>
          {t("profile.deckTeam", { name: deck.team.name, event: deck.team.eventTitle })}
        </Typography>
      )}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary" }} flexWrap="wrap" useFlexGap>
        <Typography variant="caption">
          {t(deck.slideCount === 1 ? "studio.pageCountOne" : "studio.pageCount", { n: deck.slideCount })}
        </Typography>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <VisibilityOutlinedIcon sx={{ fontSize: 14 }} aria-hidden />
          <Typography variant="caption">{t("profile.deckViews", { n: deck.views })}</Typography>
        </Stack>
        <Typography variant="caption">{formatDateTime(deck.updatedAt)}</Typography>
      </Stack>
    </Box>
  );
}
