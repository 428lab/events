import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
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
import { useNavigate, useSearchParams } from "react-router-dom";
import { EVENT_IMAGE, VENUE_TYPES, type VenueType } from "@eventer/shared";
import { useCreateEvent } from "../api/hooks.js";
import { useMyCommunities } from "../api/communityHooks.js";
import { useEventRequest, useLinkRequestEvent } from "../api/requestHooks.js";
import { ImageCropField } from "../components/ImageCropField.js";
import { EventImageStudio } from "../components/EventImageStudio.js";
import { formatDateRange, venueLabel } from "../lib/format.js";

function toEpoch(local: string): number {
  return new Date(local).getTime();
}

export function CreateEventPage() {
  const navigate = useNavigate();
  const createEvent = useCreateEvent();
  const { data: myCommunities } = useMyCommunities();
  // たまご（あったらいいな）からの開催宣言: ?fromRequest=<id> でプリフィル＋作成後リンク
  const [searchParams] = useSearchParams();
  const fromRequestId = searchParams.get("fromRequest") ?? "";
  const fromRequest = useEventRequest(fromRequestId);
  const linkRequest = useLinkRequestEvent();

  const [communityId, setCommunityId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [venueType, setVenueType] = useState<VenueType>("offline");
  const [venueOffline, setVenueOffline] = useState("");
  const [venueOnline, setVenueOnline] = useState("");
  const [contestMode, setContestMode] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);
  const [scheduleAnonymous, setScheduleAnonymous] = useState(false);
  const [imageMode, setImageMode] = useState<"upload" | "template">("upload");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  // イベント作成には成功したが、たまごへの紐付けに失敗したときの再試行用
  const [linkFailedEventId, setLinkFailedEventId] = useState<string | null>(null);

  // たまごの内容をプリフィル（1回だけ。日程は未定なので日程調整モードで開始）
  const prefilled = useRef(false);
  useEffect(() => {
    const req = fromRequest.data?.request;
    if (!req || prefilled.current) return;
    // コミュニティ付きたまごは、自分が運営するコミュニティの読み込みを待って照合する
    if (req.communityId && myCommunities == null) return;
    prefilled.current = true;
    // 既に入力があれば上書きしない
    setTitle((t) => t || req.title);
    setDescription((d) => d || req.description);
    if (req.venueTypePref) setVenueType(req.venueTypePref);
    // 自分が運営するコミュニティのときだけ引き継ぐ（権限のない紐付けを防ぐ）
    if (req.communityId && myCommunities?.some((cm) => cm.id === req.communityId)) {
      setCommunityId(req.communityId);
    }
    setScheduling(true);
  }, [fromRequest.data, myCommunities]);

  const setCropped = (blob: Blob) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(blob);
    setImagePreview(URL.createObjectURL(blob));
  };
  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(null);
    setImagePreview(null);
  };

  const canSubmit = title && (scheduling || (startsAt && endsAt));

  const submit = () => {
    createEvent.mutate(
      {
        title,
        description,
        startsAt: scheduling ? 0 : toEpoch(startsAt),
        endsAt: scheduling ? 0 : toEpoch(endsAt),
        venueType,
        venueOffline: venueOffline || null,
        venueOnline: venueOnline || null,
        aggregateSelfEntry: false,
        contestMode,
        communityId: communityId || null,
        scheduling,
        scheduleAnonymous: scheduling ? scheduleAnonymous : false,
        venueWanted,
      },
      {
        onSuccess: async ({ event }) => {
          if (imageBlob) {
            await fetch(`/api/events/${event.id}/image`, {
              method: "PUT",
              headers: { "Content-Type": imageBlob.type },
              credentials: "include",
              body: imageBlob,
            }).catch(() => undefined);
          }
          // たまごからの開催宣言なら紐付け（公開時に賛同者へ通知される）。
          // 失敗したら遷移せず、このページで再試行できるようにする
          if (fromRequestId) {
            try {
              await linkRequest.mutateAsync({
                requestId: fromRequestId,
                eventId: event.id,
              });
            } catch {
              setLinkFailedEventId(event.id);
              return;
            }
          }
          navigate(`/events/${event.id}`);
        },
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          イベント作成
        </Typography>
        <Stack spacing={2.5} sx={{ mt: 2 }}>
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
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              label="コミュニティ（任意）"
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              fullWidth
              helperText="主催コミュニティに紐付けると、そのコミュニティページに表示されます"
            >
              <MenuItem value="">なし</MenuItem>
              {myCommunities.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={scheduling}
                onChange={(e) => setScheduling(e.target.checked)}
              />
            }
            label="日程調整（日程未定で公開。候補日に参加者が○△×で回答）"
          />
          {scheduling && (
            <FormControlLabel
              sx={{ ml: 3 }}
              control={
                <Switch
                  checked={scheduleAnonymous}
                  onChange={(e) => setScheduleAnonymous(e.target.checked)}
                />
              }
              label="回答者を匿名にする（人数のみ表示。大人数向け）"
            />
          )}
          {!scheduling && (
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
              オフなら告知・募集だけの一般イベントになります（採点や表彰は表示されません）。あとから変更できます。
            </Typography>
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

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              イベント画像（OG画像 {EVENT_IMAGE.width}×{EVENT_IMAGE.height}・任意）
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={imageMode}
              onChange={(_e, v) => v && setImageMode(v)}
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="upload">アップロード</ToggleButton>
              <ToggleButton value="template">テンプレートで作る</ToggleButton>
            </ToggleButtonGroup>

            {imagePreview && (
              <Box
                component="img"
                src={imagePreview}
                alt="preview"
                sx={{
                  width: "100%",
                  maxWidth: 480,
                  aspectRatio: `${EVENT_IMAGE.width} / ${EVENT_IMAGE.height}`,
                  objectFit: "cover",
                  borderRadius: 1,
                  display: "block",
                  mb: 1,
                }}
              />
            )}

            {imageMode === "upload" ? (
              <Stack direction="row" spacing={1}>
                <ImageCropField
                  label={imagePreview ? "画像を変更" : "画像を選択"}
                  onCropped={setCropped}
                />
                {imagePreview && (
                  <Button color="error" onClick={clearImage}>
                    削除
                  </Button>
                )}
              </Stack>
            ) : (
              <EventImageStudio
                title={title}
                subtitle={
                  startsAt
                    ? formatDateRange(
                        toEpoch(startsAt),
                        toEpoch(endsAt || startsAt),
                      )
                    : undefined
                }
                onGenerated={setCropped}
              />
            )}
          </Box>

          {createEvent.isError && (
            <Typography color="error" variant="body2">
              作成に失敗しました。入力内容を確認してください。
            </Typography>
          )}
          {linkFailedEventId ? (
            <Stack spacing={1}>
              <Typography color="error" variant="body2">
                イベントは作成されましたが、たまごへの紐付けに失敗しました。
              </Typography>
              <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button onClick={() => navigate(`/events/${linkFailedEventId}`)}>
                  紐付けせずイベントへ
                </Button>
                <Button
                  variant="contained"
                  disabled={linkRequest.isPending}
                  onClick={async () => {
                    try {
                      await linkRequest.mutateAsync({
                        requestId: fromRequestId,
                        eventId: linkFailedEventId,
                      });
                      navigate(`/events/${linkFailedEventId}`);
                    } catch {
                      // 失敗表示のまま再試行可能
                    }
                  }}
                >
                  紐付けを再試行
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button onClick={() => navigate(-1)}>キャンセル</Button>
              <Button
                variant="contained"
                disabled={!canSubmit || createEvent.isPending}
                onClick={submit}
              >
                作成
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
