import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MonitorIcon from "@mui/icons-material/Monitor";
import { useTranslation } from "react-i18next";
import type { Deck, DeckSummary, EventLiveState, LivePresenter, UpdateEventLiveStateInput } from "@eventer/shared";
import { formatTime } from "../lib/format.js";
import { SlideStage } from "./SlideStage.js";

/** 配信コントロールの「発表者とスライド」(#571)。
 *
 * - 発表者一覧はタイムテーブルの担当者付きコマ（サーバーが並べて返す）。選ぶと
 *   `presenterItemId` だけを送り、デッキとページはサーバーが決める。**シーンは切り替えない**
 * - プレビューは配信中のデッキそのもの（`live-deck-content`）。‹ ›・← →・サムネイルで `deckPage` を書く
 * - 従来の「自分のデッキ」選択は「その他のスライド」として残す（選ぶと発表者の選択は外れる） */
export function LivePresenterSlides({
  state,
  presenters,
  deck,
  myDecks,
  onUpdate,
}: {
  state: EventLiveState | undefined;
  presenters: LivePresenter[] | undefined;
  deck: Deck | null | undefined;
  myDecks: DeckSummary[] | undefined;
  onUpdate: (patch: UpdateEventLiveStateInput) => void;
}) {
  const { t } = useTranslation();
  const selectedId = state?.presenterItemId ?? null;
  const selected = (presenters ?? []).find((p) => p.itemId === selectedId) ?? null;
  const slides = deck?.content.slides ?? [];
  const page = Math.min(state?.deckPage ?? 0, Math.max(0, slides.length - 1));
  const canPrev = Boolean(deck) && page > 0;
  const canNext = Boolean(deck) && page < slides.length - 1;
  const goTo = (next: number) => onUpdate({ deckPage: next });

  // ← / → キー（DeckViewerPage と同じキー）。入力中は奪わない
  const keyState = useRef({ canPrev, canNext, page, goTo });
  keyState.current = { canPrev, canNext, page, goTo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || target.isContentEditable || target.closest("[role=listbox],[role=dialog]"))) return;
      const s = keyState.current;
      if (e.key === "ArrowRight" && s.canNext) { e.preventDefault(); s.goTo(s.page + 1); }
      if (e.key === "ArrowLeft" && s.canPrev) { e.preventDefault(); s.goTo(s.page - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const speakerName = (p: LivePresenter) => p.speaker ? (p.speaker.globalName ?? p.speaker.username) : p.speakerName;
  const heading = selected
    ? t("studio.presenterSlidesHeading", { name: speakerName(selected), title: deck ? deck.title || t("studio.untitledDeck") : t("studio.presenterNoSlides") })
    : deck ? deck.title || t("studio.untitledDeck") : t("nav.decks");

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <MonitorIcon fontSize="small" />
        {t("nav.decks")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
        {/* 発表者一覧 */}
        <Box sx={{ flex: "1 1 280px", minWidth: 0, maxWidth: { md: 380 }, border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
          <Typography fontWeight={700} sx={{ mb: 0.5 }}>
            {t("studio.presentersHeading")}{" "}
            <Typography component="span" variant="caption" color="text.secondary">{t("studio.presentersOrder")}</Typography>
          </Typography>
          {presenters && presenters.length === 0 && (
            <Typography variant="body2" color="text.secondary">{t("studio.presentersEmpty")}</Typography>
          )}
          <Stack role="list" spacing={0.5}>
            {(presenters ?? []).map((p) => {
              const isSelected = p.itemId === selectedId;
              const name = speakerName(p);
              const chip = p.deck
                ? <Chip size="small" color="primary" variant="outlined" label={t("studio.presenterDeckPages", { n: p.deck.slideCount })} />
                : <Chip size="small" variant="outlined" label={t(p.linkable ? "studio.presenterNoDeck" : "studio.presenterUnlinkable")} />;
              return (
                <Box
                  key={p.itemId}
                  role="listitem"
                  component="button"
                  type="button"
                  disabled={!p.linkable}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onUpdate({ presenterItemId: p.itemId })}
                  sx={{
                    display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 1, alignItems: "center",
                    width: "100%", textAlign: "left", font: "inherit", color: "inherit", bgcolor: isSelected ? "action.selected" : "transparent",
                    border: 2, borderColor: isSelected ? "secondary.main" : "transparent", borderRadius: 1.5, p: 1,
                    cursor: p.linkable ? "pointer" : "default", opacity: p.linkable ? 1 : 0.55,
                    "&:hover:not(:disabled)": { borderColor: isSelected ? "secondary.main" : "divider" },
                  }}
                >
                  <Avatar src={p.speaker?.avatarUrl ?? undefined} sx={{ width: 36, height: 36 }}>{name.slice(0, 1)}</Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>
                      {name}
                      {isSelected && <Chip size="small" color="secondary" label={t("studio.presenterLive")} sx={{ ml: 0.75, height: 18, fontSize: 11, fontWeight: 700 }} />}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {p.startsAt !== null ? `${formatTime(p.startsAt)} ` : ""}{p.title}
                    </Typography>
                  </Box>
                  {chip}
                </Box>
              );
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, mb: 0 }}>
            {t("studio.presentersHint")}
          </Typography>
        </Box>

        {/* プレビューとページ送り */}
        <Box sx={{ flex: "2 1 320px", minWidth: 0, border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
          <Typography fontWeight={700} sx={{ mb: 1 }} noWrap>{heading}</Typography>
          {deck && slides[page] ? (
            <>
              <FitWidth>{(w) => <Box sx={{ lineHeight: 0, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}><SlideStage slide={slides[page]!} width={w - 2} /></Box>}</FitWidth>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                <Button variant="outlined" size="large" aria-label={t("studio.slidePrev")} disabled={!canPrev} onClick={() => goTo(page - 1)}>
                  <ChevronLeftIcon />
                </Button>
                <Typography sx={{ minWidth: 64, textAlign: "center" }} fontWeight={700}>
                  {page + 1} / {slides.length}
                </Typography>
                <Button variant="outlined" size="large" aria-label={t("studio.slideNext")} disabled={!canNext} onClick={() => goTo(page + 1)}>
                  <ChevronRightIcon />
                </Button>
                <Typography variant="caption" color="text.secondary">{t("studio.slideKeysHint")}</Typography>
              </Stack>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 0.75, mt: 1.5 }}>
                {slides.map((slide, i) => (
                  <Box
                    key={slide.id}
                    component="button"
                    type="button"
                    aria-label={t("studio.slideJump", { n: i + 1 })}
                    aria-current={i === page ? "true" : undefined}
                    onClick={() => goTo(i)}
                    sx={{ p: 0, lineHeight: 0, cursor: "pointer", bgcolor: "transparent", border: 2, borderColor: i === page ? "secondary.main" : "divider", borderRadius: 1, overflow: "hidden" }}
                  >
                    <FitWidth>{(w) => <SlideStage slide={slide} width={w} />}</FitWidth>
                  </Box>
                ))}
              </Box>
            </>
          ) : selected ? (
            <Box sx={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", textAlign: "center", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1, p: 2 }}>
              <Typography variant="body2" color="text.secondary">{t("studio.presenterNoDeckPreview")}</Typography>
            </Box>
          ) : null}
          <TextField
            select
            size="small"
            label={t("studio.otherDecks")}
            value={!selectedId && state?.deckId && (myDecks ?? []).some((d) => d.id === state.deckId) ? state.deckId : ""}
            onChange={(e) => onUpdate({ deckId: e.target.value || null, deckPage: 0 })}
            sx={{ minWidth: 240, mt: 2 }}
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
          >
            <MenuItem value="">{t("studio.noneOption")}</MenuItem>
            {(myDecks ?? []).map((d) => (
              <MenuItem key={d.id} value={d.id}>{d.title || t("studio.untitledDeck")}</MenuItem>
            ))}
          </TextField>
        </Box>
      </Box>
    </Stack>
  );
}

/** 親の幅に合わせてスライドを描く（幅が分かるまでは描かない） */
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
