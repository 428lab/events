import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useCreateLiveSet,
  useDeleteLiveSet,
  useMyLiveSets,
} from "../api/liveSetHooks.js";
import { formatDateTime } from "../lib/format.js";
import { defaultLiveSetContent, visualLiveSetContent } from "@eventer/shared";
import { LiveSceneStage } from "../components/LiveStage.js";

export function LiveSetsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: liveSets, isLoading } = useMyLiveSets();
  const create = useCreateLiveSet();
  const del = useDeleteLiveSet();

  const newSet = (templateId?: "glow" | "signal") =>
    create.mutate(
      { name: templateId === "glow" ? "灯り" : templateId === "signal" ? "輪郭" : "", templateId },
      { onSuccess: (s) => navigate(`/live-sets/${s.id}/edit`) },
    );
  const duplicateSet = (baseId: string, baseName: string) =>
    create.mutate(
      /** 保存されるデータ。訳す方針は #364 (#367) */
      { name: `${baseName}のコピー`, baseLiveSetId: baseId },
      { onSuccess: (s) => navigate(`/live-sets/${s.id}/edit`) },
    );

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        spacing={1.5}
      >
        <Box>
          <Typography variant="h5" fontWeight={700}>
            {t("studio.liveSets")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("studio.liveSetsLead")}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => newSet()}
          disabled={create.isPending}
        >
          {t("studio.newLiveSet")}
        </Button>
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
        {([undefined, "glow", "signal"] as const).map(style => (
          <Card key={style ?? "default"} variant="outlined" sx={{ overflow: "hidden" }}>
            <Box sx={{ bgcolor: style === "signal" ? "#0A1120" : "#0E1426", color: "#EAF0F7", p: 1.5 }}>
              <Typography fontWeight={700}>{style === "glow" ? "灯り / Glow" : style === "signal" ? "輪郭 / Signal" : "デフォルト"}</Typography>
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, overflow: "hidden" }}>
                {(() => { const scenes = style ? visualLiveSetContent(style).scenes : defaultLiveSetContent().scenes; return [scenes[0], scenes[style ? 2 : 3]].map((scene, i) => <Box key={scene.id} sx={{ flex: "1 1 0", minWidth: 0, overflow: "hidden" }}><LiveSceneStage scene={scene} width={130} /><Typography variant="caption" color="inherit">{i ? "講演" : "待機"}（見本）</Typography></Box>); })()}
              </Stack>
            </Box>
            <CardContent><Typography variant="body2" sx={{ mb: 1 }}>{style === "glow" ? "夜空と琥珀の灯り" : style === "signal" ? "明快な情報レール" : "これまでのシンプルな7シーン"}</Typography>
              <Button disabled={create.isPending} onClick={() => newSet(style)}>このスタイルで作成</Button>
            </CardContent>
          </Card>
        ))}
      </Box>
      {create.isError && <Typography color="error">作成できませんでした。再試行してください。</Typography>}
      {isLoading || !liveSets ? (
        <Typography>{t("common.loading")}</Typography>
      ) : liveSets.length === 0 ? (
        <Typography color="text.secondary">
          {t("studio.liveSetsEmpty", { action: t("studio.newLiveSet") })}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {liveSets.map((s) => (
            <Card key={s.id} variant="outlined">
              <CardActionArea onClick={() => navigate(`/live-sets/${s.id}/edit`)}>
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                    }}
                  >
                    <Typography
                      fontWeight={600}
                      sx={{
                        flex: 1,
                        minWidth: 160,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                      }}
                    >
                      <LiveTvIcon fontSize="small" />
                      {s.name || t("studio.untitledLiveSet")}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t(
                        s.sceneCount === 1
                          ? "studio.sceneCountOne"
                          : "studio.sceneCount",
                        { n: s.sceneCount },
                      )}
                      {t("common.dotSeparator")}
                      {t("studio.updatedAtSuffix", {
                        time: formatDateTime(s.updatedAt),
                      })}
                    </Typography>
                    <Tooltip title={t("studio.liveSetDuplicate")}>
                      <IconButton
                        size="small"
                        disabled={create.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          // 保存されるデータ。訳す方針は #364 (#367)
                          duplicateSet(s.id, s.name || "配信セット");
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("common.delete")}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              t("studio.deleteConfirm", { name: s.name }),
                            )
                          ) {
                            del.mutate(s.id);
                          }
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
