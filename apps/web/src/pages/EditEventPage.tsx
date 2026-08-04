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
import StadiumIcon from "@mui/icons-material/Stadium";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useNavigate, useParams } from "react-router-dom";
import { VENUE_TYPES, type VenueType } from "@eventer/shared";
import {
  useDeleteEvent,
  useDuplicateEvent,
  useEvent,
  useIsAdmin,
  useUpdateEvent,
} from "../api/hooks.js";
import { useMyCommunities } from "../api/communityHooks.js";
import { generateEventImageBlob } from "../lib/imageTemplates.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { EventImageEditor } from "../components/EventImageEditor.js";
import { MarkdownEditor } from "../components/MarkdownEditor.js";
import { EventSlotsEditor } from "../components/EventSlotsEditor.js";
import { SurveyQuestionsEditor } from "../components/SurveyQuestionsEditor.js";
import { AwardsEditor } from "../components/AwardsEditor.js";
import { venueLabel } from "../lib/format.js";

function toLocalInput(epoch: number): string {
  // 日程調整中（未確定）は 0 が入っている。1970-01-01 を出さない
  if (!epoch) return "";
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
  const duplicate = useDuplicateEvent(id);

  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [membersNote, setMembersNote] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // 日程調整中イベントで「調整をやめて直接日時を設定する」モード (#138)
  const [directDate, setDirectDate] = useState(false);
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [attendanceCheck, setAttendanceCheck] = useState(false);
  // 部屋を開設するかはスタッフが決める (#221)。新規イベントは既定OFF
  const [chatEnabled, setChatEnabled] = useState(false);
  // 参加者のURL投稿を許可するか (#241)。既定OFF（スタッフは常に可）
  const [chatUrlsAllowed, setChatUrlsAllowed] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);
  const [communityId, setCommunityId] = useState("");
  const myCommunitiesQuery = useMyCommunities();
  const myCommunities = myCommunitiesQuery.data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 複製後に /events/:newId/edit へ遷移してもコンポーネントは再マウントされないため、
  // id が変わったらフォームを新イベントの内容で初期化し直す
  useEffect(() => {
    setInitialized(false);
  }, [id]);

  useEffect(() => {
    if (data?.event && !initialized) {
      const e = data.event;
      setStatus(e.status === "published" ? "published" : "draft");
      setTitle(e.title);
      setSubtitle(e.subtitle);
      setDescription(e.description);
      setMembersNote(data.membersNote ?? "");
      setStartsAt(toLocalInput(e.startsAt));
      setEndsAt(toLocalInput(e.endsAt));
      setVenueType(e.venueType);
      setVenueOffline(e.venueOffline ?? "");
      setVenueOnline(e.venueOnline ?? "");
      setContestMode(e.contestMode);
      setAttendanceCheck(e.attendanceCheck);
      setChatEnabled(e.chatEnabled);
      setChatUrlsAllowed(e.chatUrlsAllowed);
      setVenueWanted(e.venueWanted);
      setCommunityId(e.communityId ?? "");
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
        subtitle,
        description,
        membersNote,
        // 日程調整中は日時未確定（0のまま）。入力があるときだけ送る
        ...(startsAt && endsAt
          ? {
              startsAt: new Date(startsAt).getTime(),
              endsAt: new Date(endsAt).getTime(),
            }
          : {}),
        // 日程調整をやめて直接確定 (#138)
        ...(directDate && startsAt && endsAt ? { scheduling: false as const } : {}),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        contestMode,
        attendanceCheck,
        chatEnabled,
        chatUrlsAllowed,
        venueWanted,
        communityId: communityId || null,
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
          <CounterTextField
            label="タイトル"
            value={title}
            max={200}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <CounterTextField
            label="サブタイトル（任意）"
            value={subtitle}
            max={200}
            onChange={(e) => setSubtitle(e.target.value)}
            fullWidth
          />
          <MarkdownEditor
            label="内容"
            value={description}
            onChange={setDescription}
            minRows={3}
            max={20000}
            helperText="Markdown が使えます（見出し #、リスト -、リンク [text](url)、**強調**、<img> など）"
          />
          <MarkdownEditor
            label="参加者限定の文章（参加確定した人にだけ表示）"
            value={membersNote}
            onChange={setMembersNote}
            minRows={3}
            max={20000}
            helperText="Discord の招待リンクや当日の連絡事項など、参加確定者とスタッフにだけ見せたい内容を書けます。Markdown が使えます"
          />
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              label="コミュニティ（任意）"
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              fullWidth
            >
              <MenuItem value="">なし</MenuItem>
              {myCommunities.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {event.scheduling && !directDate ? (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={() => setDirectDate(true)}>
                  日時を直接設定する
                </Button>
              }
            >
              このイベントは日程調整中です。イベントページの日程調整で確定するか、ここで日時を直接設定できます（直接設定すると日程調整は終了します）。
            </Alert>
          ) : (
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
          )}
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
            <CounterTextField
              label="オフライン会場"
              value={venueOffline}
              max={500}
              onChange={(e) => setVenueOffline(e.target.value)}
              fullWidth
            />
          )}
          {venueType !== "offline" && (
            <CounterTextField
              label="オンライン会場（Discord 招待 URL など）"
              value={venueOnline}
              max={500}
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

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={attendanceCheck}
                  onChange={(e) => setAttendanceCheck(e.target.checked)}
                />
              }
              label="出席チェックモード"
            />
            <Typography variant="caption" color="text.secondary" display="block">
              オンにすると、スタッフが出席チェックした人だけが参加者として記録されます。チェックされなかった人は参加人数・参加履歴に含まれません（当日受付・ドタキャン対策に）。
            </Typography>
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={chatEnabled}
                  onChange={(e) => setChatEnabled(e.target.checked)}
                />
              }
              label="参加者チャット"
            />
            <Typography variant="caption" color="text.secondary" display="block">
              参加確定メンバーがイベントページでチャットできます。チャットの内容は公開されます。
            </Typography>
            {chatEnabled && (
              <Box sx={{ pl: 3, mt: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={chatUrlsAllowed}
                      onChange={(e) => setChatUrlsAllowed(e.target.checked)}
                    />
                  }
                  label="参加者のURL投稿を許可"
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                >
                  オンにすると参加者もチャットにURLを投稿できます。スタッフは常に投稿できます。
                </Typography>
              </Box>
            )}
          </Box>

          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={venueWanted}
                  onChange={(e) => setVenueWanted(e.target.checked)}
                />
              }
              label={
                <Box
                  component="span"
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
                >
                  <StadiumIcon fontSize="small" />
                  会場を探しています
                </Box>
              }
            />
            <Typography variant="caption" color="text.secondary" display="block">
              オンにすると会場提供者からのオファーを受け付けます（会場募集一覧にも掲載）。
            </Typography>
          </Box>

          <Divider />
          <EventSlotsEditor eventId={id} />

          <Divider />
          <SurveyQuestionsEditor eventId={id} />

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
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} justifyContent="flex-end">
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
            <Typography variant="subtitle2" gutterBottom>
              イベントの複製
            </Typography>
            <Button
              startIcon={<ContentCopyIcon />}
              disabled={duplicate.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "このイベントを複製しますか？（参加者・エントリー・コメント・写真はコピーされません）",
                  )
                ) {
                  return;
                }
                duplicate.mutate(undefined, {
                  onSuccess: async ({ event: created }) => {
                    // 元イベントに画像が無い場合はコピーもされないため、
                    // 作成時と同様にタイトルから自動生成する (#139)
                    if (!created.imageUpdatedAt) {
                      const blob = await generateEventImageBlob(
                        created.title,
                        created.scheduling ? "日程調整中" : undefined,
                      ).catch(() => null);
                      if (blob) {
                        await fetch(`/api/events/${created.id}/image`, {
                          method: "PUT",
                          headers: { "Content-Type": blob.type },
                          credentials: "include",
                          body: blob,
                        }).catch(() => undefined);
                      }
                    }
                    navigate(`/events/${created.id}/edit`);
                  },
                });
              }}
            >
              イベントを複製
            </Button>
            <Typography variant="caption" color="text.secondary" display="block">
              タイトル・説明・参加枠・採点基準・表彰・画像などをコピーした下書きイベントを新しく作ります。
            </Typography>
            {duplicate.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                複製に失敗しました。
              </Alert>
            )}
          </Box>

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
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} alignItems="center">
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
                      onSuccess: () => navigate("/"),
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
