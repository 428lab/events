import { useState } from "react";
import {
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
import { useNavigate, useSearchParams } from "react-router-dom";
import type { VenueType } from "@eventer/shared";
import { VENUE_TYPES } from "@eventer/shared";
import { useCreateEventRequest } from "../api/requestHooks.js";
import { useMyJoinedCommunities } from "../api/communityHooks.js";
import { venueLabel } from "../lib/format.js";

/** イベントのたまご投稿（あったらいいな）。 */
export function EventRequestNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateEventRequest();
  const { data: myCommunities } = useMyJoinedCommunities();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venuePref, setVenuePref] = useState<VenueType | "">("");
  const [communityId, setCommunityId] = useState(
    searchParams.get("communityId") ?? "",
  );
  const [membersOnly, setMembersOnly] = useState(false);
  const [venueWanted, setVenueWanted] = useState(false);

  const submit = () => {
    create.mutate(
      {
        title,
        description,
        venueTypePref: venuePref || null,
        communityId: communityId || null,
        membersOnly: communityId ? membersOnly : false,
        venueWanted,
      },
      {
        onSuccess: ({ request }) => navigate(`/requests/${request.id}`),
      },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          🥚 たまごを投稿
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          「こんなイベントがあったらいいな」を投稿すると、賛同や「開催してもいい」が集まります。誰かが開催を宣言したら通知が届きます。
        </Typography>
        <Stack spacing={2.5}>
          <TextField
            label="あったらいいなイベント"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="例: もくもく会を毎週やってほしい"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <TextField
            label="詳しく（任意）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="どんな内容・雰囲気・場所でやってほしい？"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            fullWidth
          />
          <div>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              希望の開催形態（任意）
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={venuePref}
              onChange={(_e, v: VenueType | null) => setVenuePref(v ?? "")}
            >
              {VENUE_TYPES.map((v) => (
                <ToggleButton key={v} value={v}>
                  {venueLabel[v]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </div>
          {myCommunities && myCommunities.length > 0 && (
            <TextField
              select
              label="コミュニティ（任意）"
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              helperText="選ぶとコミュニティのたまごとして表示されます"
              fullWidth
            >
              <MenuItem value="">なし（全体公開）</MenuItem>
              {myCommunities.map((cm) => (
                <MenuItem key={cm.id} value={cm.id}>
                  {cm.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <FormControlLabel
            control={
              <Switch
                checked={venueWanted}
                onChange={(e) => setVenueWanted(e.target.checked)}
              />
            }
            label="🏟️ 会場も探しています（会場提供者からのオファーを受け付ける）"
          />
          {communityId && (
            <FormControlLabel
              control={
                <Switch
                  checked={membersOnly}
                  onChange={(e) => setMembersOnly(e.target.checked)}
                />
              }
              label="コミュニティメンバーだけに見せる"
            />
          )}
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!title.trim() || create.isPending}
            >
              投稿する
            </Button>
            <Button onClick={() => navigate(-1)}>キャンセル</Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
