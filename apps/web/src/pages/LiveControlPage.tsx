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
import { useEvent, useIsAdmin } from "../api/hooks.js";
import {
  useEventLiveSetContent,
  useEventLiveState,
  useUpdateEventLiveState,
} from "../api/liveControlHooks.js";
import { useMyLiveSets } from "../api/liveSetHooks.js";
import { LiveSceneStage } from "../components/LiveStage.js";

/** 配信コントロールタブ（シーン切替・配信セット選択）。スマホでも操作できる */
export function LiveControlPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const isAdmin = useIsAdmin();
  const { data: state } = useEventLiveState(id);
  const { data: liveSet } = useEventLiveSetContent(id, state?.liveSetId);
  const { data: mySets } = useMyLiveSets();
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
