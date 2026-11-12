import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PresentedDeck } from "@eventer/shared";
import { usePresentedDecks } from "../api/scoringHooks.js";
import { ensureDeckFonts } from "../lib/deckFonts.js";
import { SlideStage } from "./SlideStage.js";
import { DeckExportMenu } from "./DeckExportMenu.js";

/**
 * イベントページの「発表スライド」(docs/contest-organizer-ux.md「発表スライドをイベントページに出す」)。
 * 成果物の資料が events lab のスライドのエントリー（チーム・個人）を、1枚目のサムネで並べる。
 * 見せてよいか（発表が終わったか）はサーバーが決め、運営には終わる前から「運営だけに表示中」で出す。
 * 外部のスライド（Google スライド等）は成果物一覧のリンクのまま（ここでは埋め込まない）
 */
export function PresentedDecks({ eventId, contest }: { eventId: string; contest: boolean }) {
  const { t } = useTranslation();
  const { data } = usePresentedDecks(eventId, contest);
  if (!contest || !data || data.decks.length === 0) return null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          <Typography variant="h6">{t("eventDetail.presentedDecksHeading")}</Typography>
          {data.staffPreview && <Chip size="small" color="warning" label={t("eventDetail.presentedDecksStaffOnly")} />}
        </Stack>
        <Box
          component="ul"
          sx={{
            listStyle: "none", p: 0, m: 0, display: "grid", gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
          }}
        >
          {data.decks.map((d) => <PresentedDeckItem key={d.entryId} item={d} />)}
        </Box>
      </CardContent>
    </Card>
  );
}

function PresentedDeckItem({ item }: { item: PresentedDeck }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { firstSlide } = item.deck;

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (firstSlide) ensureDeckFonts({ slides: [firstSlide] });
  }, [firstSlide]);

  return (
    <Box component="li" sx={{ minWidth: 0 }}>
      <Box
        ref={frame}
        component={RouterLink}
        to={`/d/${item.deck.slug}`}
        aria-label={t("eventDetail.presentedDeckOpen", { name: item.entryName })}
        sx={{
          display: "block", width: "100%", aspectRatio: "16 / 9", bgcolor: "#000",
          borderRadius: 1, overflow: "hidden",
        }}
      >
        {firstSlide && width > 0 && (
          <Box sx={{ pointerEvents: "none" }}>
            <SlideStage slide={firstSlide} width={width} />
          </Box>
        )}
      </Box>
      <Typography variant="subtitle2" sx={{ mt: 1, overflowWrap: "anywhere" }}>{item.entryName}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
        {t("eventDetail.presentedDeckMeta", { title: item.deck.title, n: item.deck.slideCount })}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center">
        <Button size="small" component={RouterLink} to={`/d/${item.deck.slug}`}>{t("eventDetail.presentedDeckView")}</Button>
        <DeckExportMenu slug={item.deck.slug} />
      </Stack>
    </Box>
  );
}
