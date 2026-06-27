import { useEffect, useState } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { useCommunity, useUpdateCommunity } from "../api/communityHooks.js";

export function CommunityEditPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { data: c, isLoading } = useCommunity(slug);
  const update = useUpdateCommunity(slug);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (c && !initialized) {
      setName(c.name);
      setDescription(c.description);
      setInitialized(true);
    }
  }, [c, initialized]);

  if (isLoading || !c) return <Typography>読み込み中…</Typography>;
  const isManager = c.myRole === "owner" || c.myRole === "admin";
  if (!isManager) {
    return <Alert severity="info">このコミュニティの編集権限がありません。</Alert>;
  }

  const save = () => {
    update.mutate(
      { id: c.id, input: { name: name.trim(), description } },
      { onSuccess: () => navigate(`/c/${slug}`) },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 560 }}>
      <Typography variant="h5" fontWeight={700}>
        コミュニティを編集
      </Typography>
      <Typography variant="caption" color="text.secondary">
        コミュニティID（@{c.slug}）は変更できません。
      </Typography>
      <TextField
        label="コミュニティ名"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        fullWidth
      />
      <TextField
        label="説明"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={3}
        fullWidth
        helperText="Markdown が使えます"
      />
      <Stack direction="row" spacing={1}>
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
