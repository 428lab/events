import { useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { LiveScene } from "@eventer/shared";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import EditIcon from "@mui/icons-material/Edit";
import { Link as RouterLink, useParams } from "react-router-dom";
import { DEFAULT_LIVE_SET_ID } from "@eventer/shared";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useEvent, useIsAdmin } from "../api/hooks.js";
import {
  useEventLiveDeck,
  useEventLiveSetContent,
  useEventLiveState,
  useUpdateEventLiveState,
} from "../api/liveControlHooks.js";
import { useMyLiveSets } from "../api/liveSetHooks.js";
import { useMyDecks } from "../api/deckHooks.js";
import { LiveSceneStage } from "../components/LiveStage.js";
import { SlideStage } from "../components/SlideStage.js";

/** 配信コントロールタブ（シーン切替・配信セット選択）。スマホでも操作できる */
export function LiveControlPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: state } = useEventLiveState(id);
  const { data: liveSet } = useEventLiveSetContent(id, state?.liveSetId);
  const { data: mySets } = useMyLiveSets();
  const { data: myDecks } = useMyDecks();
  const { data: deck } = useEventLiveDeck(id, state?.deckId);
  const update = useUpdateEventLiveState(id);

  const isStaff = eventData?.myRole === "staff" || isAdmin;
  if (eventData && !isStaff) {
    return <Alert severity="warning">この画面はスタッフ専用です。</Alert>;
  }

  const scenes = liveSet?.content.scenes ?? [];
  const activeId =
    scenes.find((s) => s.id === state?.activeSceneId)?.id ?? scenes[0]?.id;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1, minWidth: 200 }}>
          🎬 配信コントロール
        </Typography>
        <Button
          variant="contained"
          startIcon={<OpenInNewIcon />}
          component={RouterLink}
          to={`/events/${id}/live/screen`}
          target="_blank"
        >
          配信画面を開く
        </Button>
      </Stack>

      <Alert severity="info" sx={{ py: 0.5 }}>
        「配信画面を開く」で出る画面を OBS
        の「ウィンドウキャプチャ」で取り込んでください（音声はデスクトップ音声）。シーンを切り替えると配信画面に約1秒で反映されます。
      </Alert>

      {/* 配信セット選択 */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="配信セット"
          value={state?.liveSetId ?? DEFAULT_LIVE_SET_ID}
          onChange={(e) =>
            update.mutate({
              liveSetId:
                e.target.value === DEFAULT_LIVE_SET_ID ? null : e.target.value,
              activeSceneId: null,
            })
          }
          sx={{ minWidth: 220 }}
        >
          <MenuItem value={DEFAULT_LIVE_SET_ID}>デフォルト（ビルトイン）</MenuItem>
          {(mySets ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name || "無題の配信セット"}
            </MenuItem>
          ))}
        </TextField>
        {state?.liveSetId && state.liveSetId !== DEFAULT_LIVE_SET_ID && (
          <Button
            size="small"
            startIcon={<EditIcon />}
            component={RouterLink}
            to={`/live-sets/${state.liveSetId}/edit`}
          >
            セットを編集
          </Button>
        )}
        <Button size="small" component={RouterLink} to="/live-sets">
          セット一覧
        </Button>
      </Stack>

      {/* シーングリッド（タップで切替） */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, 1fr)",
            sm: "repeat(3, 1fr)",
            md: "repeat(4, 1fr)",
          },
          gap: 1.5,
        }}
      >
        {scenes.map((s) => {
          const active = s.id === activeId;
          return (
            <Box
              key={s.id}
              onClick={() => update.mutate({ activeSceneId: s.id })}
              sx={{
                cursor: "pointer",
                border: "3px solid",
                borderColor: active ? "secondary.main" : "divider",
                borderRadius: 1.5,
                overflow: "hidden",
                position: "relative",
                lineHeight: 0,
                "&:hover": { borderColor: active ? "secondary.main" : "primary.main" },
              }}
            >
              <ResponsiveScene sceneId={s.id} scene={s} />
              <Box
                sx={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  px: 1,
                  py: 0.25,
                  bgcolor: "rgba(0,0,0,0.6)",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                }}
              >
                <Typography variant="caption" sx={{ color: "#fff", flex: 1 }} noWrap>
                  {s.name}
                </Typography>
                {active && (
                  <Chip
                    size="small"
                    color="secondary"
                    label="ON AIR"
                    sx={{ height: 16, fontSize: 10, fontWeight: 700 }}
                  />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {scenes.length === 0 && (
        <Typography color="text.secondary">
          配信セットにシーンがありません。「セットを編集」から追加してください。
        </Typography>
      )}

      {/* スライド（デッキ）選択とページ送り */}
      <Stack spacing={1}>
        <Typography variant="h6">🖥️ スライド</Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label="配信で映すスライド"
            value={state?.deckId ?? ""}
            onChange={(e) =>
              update.mutate({
                deckId: e.target.value || null,
                deckPage: 0,
              })
            }
            sx={{ minWidth: 220 }}
            SelectProps={{ displayEmpty: true }}
          >
            <MenuItem value="">（なし）</MenuItem>
            {(myDecks ?? []).map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.title || "無題のスライド"}
              </MenuItem>
            ))}
          </TextField>
          {deck && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="outlined"
                size="large"
                disabled={(state?.deckPage ?? 0) <= 0}
                onClick={() =>
                  update.mutate({ deckPage: Math.max(0, (state?.deckPage ?? 0) - 1) })
                }
              >
                <ChevronLeftIcon />
              </Button>
              <Typography sx={{ minWidth: 64, textAlign: "center" }} fontWeight={700}>
                {Math.min((state?.deckPage ?? 0) + 1, deck.content.slides.length)} /{" "}
                {deck.content.slides.length}
              </Typography>
              <Button
                variant="outlined"
                size="large"
                disabled={(state?.deckPage ?? 0) >= deck.content.slides.length - 1}
                onClick={() =>
                  update.mutate({
                    deckPage: Math.min(
                      deck.content.slides.length - 1,
                      (state?.deckPage ?? 0) + 1,
                    ),
                  })
                }
              >
                <ChevronRightIcon />
              </Button>
            </Stack>
          )}
        </Stack>
        {deck && deck.content.slides[state?.deckPage ?? 0] && (
          <Box
            sx={{
              width: 240,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              overflow: "hidden",
              lineHeight: 0,
            }}
          >
            <SlideStage slide={deck.content.slides[state?.deckPage ?? 0]} width={238} />
          </Box>
        )}
      </Stack>
    </Stack>
  );
}

/** グリッド幅に追従するシーンサムネイル */
function ResponsiveScene({ scene }: { sceneId: string; scene: LiveScene }) {
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
  return (
    <div ref={ref} style={{ width: "100%", pointerEvents: "none" }}>
      {w > 0 && <LiveSceneStage scene={scene} width={w} />}
    </div>
  );
}
