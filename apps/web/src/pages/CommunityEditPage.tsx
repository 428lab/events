import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useNavigate, useParams } from "react-router-dom";
import { COMMUNITY_BANNER, COMMUNITY_ICON } from "@eventer/shared";
import type { CommunityLink } from "@eventer/shared";
import {
  useCommunity,
  useUpdateCommunity,
  useUploadCommunityImage,
} from "../api/communityHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { ImageCropField } from "../components/ImageCropField.js";

export function CommunityEditPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: c, isLoading } = useCommunity(slug);
  const update = useUpdateCommunity(slug);
  const upload = useUploadCommunityImage(slug);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<CommunityLink[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (c && !initialized) {
      setName(c.name);
      setDescription(c.description);
      setLinks(c.links);
      setInitialized(true);
    }
  }, [c, initialized]);

  if (isLoading || !c) return <Typography>読み込み中…</Typography>;
  const isManager = c.myRole === "owner" || c.myRole === "admin";
  if (!isManager) {
    return <Alert severity="info">このコミュニティの編集権限がありません。</Alert>;
  }

  const setLink = (i: number, patch: Partial<CommunityLink>) =>
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cleanLinks = links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label && l.url);

  const save = () => {
    update.mutate(
      { id: c.id, input: { name: name.trim(), description, links: cleanLinks } },
      { onSuccess: () => navigate(`/c/${slug}`) },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="h5" fontWeight={700}>
        コミュニティを編集
      </Typography>

      {/* 画像 */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          バナー
        </Typography>
        <Box
          sx={{
            width: "100%",
            aspectRatio: `${COMMUNITY_BANNER.width} / ${COMMUNITY_BANNER.height}`,
            bgcolor: "action.hover",
            borderRadius: 2,
            overflow: "hidden",
            mb: 1,
          }}
        >
          {c.bannerUrl && (
            <Box
              component="img"
              src={c.bannerUrl}
              alt=""
              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </Box>
        <ImageCropField
          label="バナーを選ぶ"
          busy={upload.isPending}
          outWidth={COMMUNITY_BANNER.width}
          outHeight={COMMUNITY_BANNER.height}
          maxBytes={COMMUNITY_BANNER.maxBytes}
          onCropped={(blob) =>
            upload.mutate({ communityId: c.id, kind: "banner", blob })
          }
        />
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          アイコン
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            src={c.iconUrl ?? undefined}
            variant="rounded"
            sx={{ width: 72, height: 72, fontSize: 32 }}
          >
            {c.name.charAt(0)}
          </Avatar>
          <ImageCropField
            label="アイコンを選ぶ"
            busy={upload.isPending}
            outWidth={COMMUNITY_ICON.width}
            outHeight={COMMUNITY_ICON.height}
            maxBytes={COMMUNITY_ICON.maxBytes}
            onCropped={(blob) =>
              upload.mutate({ communityId: c.id, kind: "icon", blob })
            }
          />
        </Stack>
      </Box>

      <Divider />

      <Typography variant="caption" color="text.secondary">
        コミュニティID（@{c.slug}）は変更できません。
      </Typography>
      <CounterTextField
        label="コミュニティ名"
        value={name}
        max={60}
        onChange={(e) => setName(e.target.value)}
        required
        fullWidth
      />
      <CounterTextField
        label="説明"
        value={description}
        max={2000}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={3}
        fullWidth
        helperText="Markdown が使えます"
      />

      {/* リンク */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          リンク
        </Typography>
        <Stack spacing={1}>
          {links.map((l, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <CounterTextField
                size="small"
                label="ラベル"
                value={l.label}
                max={40}
                onChange={(e) => setLink(i, { label: e.target.value })}
                sx={{ width: 160 }}
              />
              <CounterTextField
                size="small"
                label="URL"
                slotProps={{ inputLabel: { shrink: true } }}
                value={l.url}
                max={500}
                onChange={(e) => setLink(i, { url: e.target.value })}
                fullWidth
                placeholder="https://…"
              />
              <IconButton
                aria-label="削除"
                onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
          {links.length < 10 && (
            <Button
              size="small"
              onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}
              sx={{ alignSelf: "flex-start" }}
            >
              + リンクを追加
            </Button>
          )}
        </Stack>
      </Box>

      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        <Button
          variant="contained"
          disabled={!name.trim() || update.isPending}
          onClick={save}
        >
          保存
        </Button>
        <Button onClick={() => navigate(`/c/${slug}`)}>キャンセル</Button>
      </Stack>
    </Stack>
  );
}
