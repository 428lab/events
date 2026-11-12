import { useLayoutEffect, useRef, useState } from "react";
import { Box, Button, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Deck, EventLiveStateWithCutin, UpdateEventLiveStateInput } from "@eventer/shared";
import { SlideStage } from "./SlideStage.js";
import { useLiveDeckPage } from "../lib/presentPageSync.js";

/** 配信コントロールの「コンテストの発表と連動」（docs/contest-organizer-ux.md「配信との連動」）。
 * オンのあいだ配信のスライドは発表中のエントリーのもの、ページは発表者のめくりに合わせる。
 * 発表者の選択とページ送りは進行画面（/control）の役目なので、ここはプレビューだけ */
export function LiveContestFollow({
  eventId,
  state,
  deck,
  onUpdate,
}: {
  eventId: string;
  state: EventLiveStateWithCutin;
  deck: Deck | null | undefined;
  onUpdate: (patch: UpdateEventLiveStateInput) => void;
}) {
  const { t } = useTranslation();
  const contest = state.followContest ? state.contest ?? null : null;
  const total = deck?.content.slides.length ?? 0;
  const page = useLiveDeckPage(state, total);
  const slide = deck?.content.slides[page];

  return (
    <Stack spacing={1}>
      <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <EmojiEventsIcon fontSize="small" />
        {t("studio.followContest")}
      </Typography>
      <FormControlLabel
        control={<Switch checked={state.followContest} onChange={(e) => onUpdate({ followContest: e.target.checked })} />}
        label={t("studio.followContest")}
      />
      <Typography variant="caption" color="text.secondary">{t("studio.followContestHelp")}</Typography>
      {state.followContest && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
          {!contest?.entryId ? (
            <Typography variant="body2" color="text.secondary">{t("studio.followContestNoEntry")}</Typography>
          ) : !deck || !slide ? (
            <Typography variant="body2" color="text.secondary">{t("studio.followContestNoDeck", { name: contest.entryName ?? "" })}</Typography>
          ) : (
            <>
              <Typography fontWeight={700} sx={{ mb: 1 }} noWrap>
                {t("studio.followContestDeck", { name: contest.entryName ?? "", title: deck.title || t("studio.untitledDeck") })}
              </Typography>
              <FitWidth>{(w) => <Box sx={{ lineHeight: 0, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}><SlideStage slide={slide} width={w - 2} /></Box>}</FitWidth>
              <Typography variant="body2" sx={{ mt: 1 }}>{t("studio.followContestPage", { n: page + 1, total })}</Typography>
            </>
          )}
          <Button size="small" component={RouterLink} to={`/events/${eventId}/control`} sx={{ mt: 1 }}>
            {t("studio.followContestOpenControl")}
          </Button>
        </Box>
      )}
    </Stack>
  );
}

function FitWidth({ children }: { children: (width: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} style={{ width: "100%" }}>{w > 0 && children(w)}</div>;
}
