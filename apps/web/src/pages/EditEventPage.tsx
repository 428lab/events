import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { VENUE_TYPES, type VenueType } from "@eventer/shared";
import {
  useDeleteEvent,
  useEvent,
  useIsAdmin,
  useUpdateEvent,
} from "../api/hooks.js";
import { EventImageEditor } from "../components/EventImageEditor.js";
import { EventSlotsEditor } from "../components/EventSlotsEditor.js";
import { AwardsEditor } from "../components/AwardsEditor.js";
import { venueLabel } from "../lib/format.js";

function toLocalInput(epoch: number): string {
  const d = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditEventPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useEvent(id);
  const isAdmin = useIsAdmin();
  const update = useUpdateEvent(id);
  const del = useDeleteEvent(id);

  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data?.event && !initialized) {
      const e = data.event;
      setStatus(e.status === "published" ? "published" : "draft");
      setTitle(e.title);
      setDescription(e.description);
      setStartsAt(toLocalInput(e.startsAt));
      setEndsAt(toLocalInput(e.endsAt));
      setVenueType(e.venueType);
      setVenueOffline(e.venueOffline ?? "");
      setVenueOnline(e.venueOnline ?? "");
      setContestMode(e.contestMode);
      setInitialized(true);
    }
  }, [data, initialized]);

  if (isLoading || !data) return <Typography>読み込み中…</Typography>;

  const isStaff = data.myRole === "staff" || isAdmin;
  if (!isStaff) {
    return <Alert severity="info">このイベントの編集権限がありません。</Alert>;
  }
  const { event } = data;

  const save = () => {
    update.mutate(
      {
        status,
        title,
        description,
        startsAt: new Date(startsAt).getTime(),
        endsAt: new Date(endsAt).getTime(),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        contestMode,
      },
      { onSuccess: () => navigate(`/events/${id}`) },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          イベント編集
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              公開状態
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={status}
              onChange={(_e, v) => v && setStatus(v)}
            >
              <ToggleButton value="draft">非公開（下書き）</ToggleButton>
              <ToggleButton value="published">公開</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              公開にすると未ログインでも閲覧でき、開催前なら公開トップの一覧に表示されます。
            </Typography>
          </Box>
          <TextField
            label="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="内容"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            helperText="Markdown が使えます（見出し #、リスト -、リンク [text](url)、**強調** など）"
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="開始日時"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="終了日時"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
          <TextField
            label="会場種別"
            select
            value={venueType}
            onChange={(e) => setVenueType(e.target.value as VenueType)}
            fullWidth
          >
            {VENUE_TYPES.map((v) => (
              <MenuItem key={v} value={v}>
                {venueLabel[v]}
              </MenuItem>
            ))}
          </TextField>
          {venueType !== "online" && (
            <TextField
              label="オフライン会場"
              value={venueOffline}
              onChange={(e) => setVenueOffline(e.target.value)}
              fullWidth
            />
          )}
          {venueType !== "offline" && (
            <TextField
              label="オンライン会場（Discord 招待 URL など）"
              value={venueOnline}
              onChange={(e) => setVenueOnline(e.target.value)}
              fullWidth
            />
          )}

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={contestMode}
                  onChange={(e) => setContestMode(e.target.checked)}
                />
              }
              label="コンテスト形式（採点・成果物・表彰を使う）"
            />
            <Typography variant="caption" color="text.secondary" display="block">
              オフなら告知・募集だけの一般イベントになり、採点・成果物・表彰は表示されません。
            </Typography>
          </Box>

          <Divider />
          <EventSlotsEditor eventId={id} />

          {contestMode && (
            <>
              <Divider />
              <AwardsEditor eventId={id} />
            </>
          )}

          <Divider />
          <EventImageEditor event={event} />

          {update.isError && (
            <Alert severity="error">保存に失敗しました。</Alert>
          )}
          <Stack direction="row" spacing={2} justifyContent="flex-end">
            <Button onClick={() => navigate(`/events/${id}`)}>キャンセル</Button>
            <Button
              variant="contained"
              disabled={!title || update.isPending}
              onClick={save}
            >
              保存
            </Button>
          </Stack>

          <Divider />
          <Box>
            <Typography variant="subtitle2" color="error" gutterBottom>
              危険な操作
            </Typography>
            {!confirmDelete ? (
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                このイベントを削除
              </Button>
            ) : (
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2">
                  本当に削除しますか？（参加者・採点・画像も削除されます）
                </Typography>
                <Button onClick={() => setConfirmDelete(false)}>やめる</Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={del.isPending}
                  onClick={() =>
                    del.mutate(undefined, {
                      onSuccess: () => navigate("/events"),
                    })
                  }
                >
                  削除する
                </Button>
              </Stack>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
