import { useState } from "react";
import {
  Alert,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { COMMUNITY_SLUG_RE } from "@eventer/shared";
import { useCreateCommunity } from "../api/communityHooks.js";
import { ApiError } from "../api/client.js";
import { CounterTextField } from "../components/CounterTextField.js";

export function CreateCommunityPage() {
  const navigate = useNavigate();
  const create = useCreateCommunity();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const slugValid = COMMUNITY_SLUG_RE.test(slug);
  const canSubmit = slugValid && name.trim().length > 0 && !create.isPending;

  const submit = () => {
    setError(null);
    create.mutate(
      { slug, name: name.trim(), description },
      {
        onSuccess: (c) => navigate(`/c/${c.slug}`),
        onError: (e) => {
          const status = e instanceof ApiError ? e.status : 0;
          const body =
            e instanceof ApiError ? (e.body as { error?: string }) : null;
          setError(
            body?.error === "taken"
              ? "このIDは既に使われています"
              : body?.error === "reserved"
                ? "このIDは予約語のため使用できません"
                : status === 400
                  ? "入力内容を確認してください"
                  : "作成に失敗しました",
          );
        },
      },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 560 }}>
      <Typography variant="h5" fontWeight={700}>
        コミュニティを作る
      </Typography>

      <TextField
        label="コミュニティID（URLに使います）"
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase())}
        error={slug.length > 0 && !slugValid}
        helperText={
          slug.length > 0 && !slugValid
            ? "3〜32文字の半角英小文字・数字・ハイフン（先頭末尾は英数字）"
            : `公開URL: /c/${slug || "your-id"}`
        }
        fullWidth
      />
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

      {error && <Alert severity="error">{error}</Alert>}

      <Button
        variant="contained"
        disabled={!canSubmit}
        onClick={submit}
        sx={{ alignSelf: "flex-start" }}
      >
        作成する
      </Button>
    </Stack>
  );
}
