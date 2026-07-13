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
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useNavigate } from "react-router-dom";
import {
  useCreateLiveSet,
  useDeleteLiveSet,
  useMyLiveSets,
} from "../api/liveSetHooks.js";
import { formatDateTime } from "../lib/format.js";

export function LiveSetsPage() {
  const navigate = useNavigate();
  const { data: liveSets, isLoading } = useMyLiveSets();
  const create = useCreateLiveSet();
  const del = useDeleteLiveSet();

  const newSet = () =>
    create.mutate(
      { name: "" },
      { onSuccess: (s) => navigate(`/live-sets/${s.id}/edit`) },
    );
  const duplicateSet = (baseId: string, baseName: string) =>
    create.mutate(
      { name: `${baseName}のコピー`, baseLiveSetId: baseId },
      { onSuccess: (s) => navigate(`/live-sets/${s.id}/edit`) },
    );

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" fontWeight={700}>
            配信セット
          </Typography>
          <Typography variant="body2" color="text.secondary">
            配信画面のシーン一式（待機画面・OP・スライド＋カメラなど）を作って、イベントの配信で使い回せます。
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={newSet}
          disabled={create.isPending}
        >
          新しい配信セット
        </Button>
      </Stack>

      {isLoading || !liveSets ? (
        <Typography>読み込み中…</Typography>
      ) : liveSets.length === 0 ? (
        <Typography color="text.secondary">
          まだ配信セットがありません。「新しい配信セット」を押すと、待機画面・OP・スライド＋カメラなどの定番シーン入りで作成されます。
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
                    <Typography fontWeight={600} sx={{ flex: 1, minWidth: 160 }}>
                      🎬 {s.name || "無題の配信セット"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {s.sceneCount} シーン ・ {formatDateTime(s.updatedAt)} 更新
                    </Typography>
                    <Tooltip title="このセットをベースに新規作成">
                      <IconButton
                        size="small"
                        disabled={create.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateSet(s.id, s.name || "配信セット");
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="削除">
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`「${s.name}」を削除しますか？`)) {
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
