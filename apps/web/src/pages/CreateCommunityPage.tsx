import { useState } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { COMMUNITY_SLUG_RE } from "@eventer/shared";
import { useCreateCommunity } from "../api/communityHooks.js";
import { ApiError } from "../api/client.js";
import { errorCode } from "../lib/errorMessage.js";
import { CounterTextField } from "../components/CounterTextField.js";

type CreateError = "taken" | "reserved" | "invalid" | "failed";

/** 失敗の種類 → 翻訳キー。**文言を state に持たない**（言語を切り替えると前の言語のまま残るため） */
const CREATE_ERROR_KEY = {
  taken: "community.createErrorTaken",
  reserved: "community.createErrorReserved",
  invalid: "community.createErrorInvalid",
  failed: "community.createErrorFailed",
} as const satisfies Record<CreateError, string>;

export function CreateCommunityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateCommunity();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<CreateError | null>(null);

  const slugValid = COMMUNITY_SLUG_RE.test(slug);
  const canSubmit = slugValid && name.trim().length > 0 && !create.isPending;

  const submit = () => {
    setCreateError(null);
    create.mutate(
      { slug, name: name.trim(), description },
      {
        onSuccess: (c) => navigate(`/c/${c.slug}`),
        onError: (e) => {
          const status = e instanceof ApiError ? e.status : 0;
          const code = errorCode(e);
          setCreateError(
            code === "taken"
              ? "taken"
              : code === "reserved"
                ? "reserved"
                : status === 400
                  ? "invalid"
                  : "failed",
          );
        },
      },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 560 }}>
      <Typography variant="h5" fontWeight={700}>
        {t("community.create")}
      </Typography>

      <TextField
        label={t("community.slugLabel")}
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase())}
        error={slug.length > 0 && !slugValid}
        helperText={
          slug.length > 0 && !slugValid
            ? t("community.slugHelp")
            : t("community.slugPreview", { slug: slug || "your-id" })
        }
        fullWidth
      />
      <CounterTextField
        label={t("community.nameLabel")}
        value={name}
        max={60}
        onChange={(e) => setName(e.target.value)}
        required
        fullWidth
      />
      <CounterTextField
        label={t("community.descriptionLabel")}
        value={description}
        max={2000}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={3}
        fullWidth
        helperText={t("community.markdownHelp")}
      />

      {createError && (
        <Alert severity="error">{t(CREATE_ERROR_KEY[createError])}</Alert>
      )}

      <Button
        variant="contained"
        disabled={!canSubmit}
        onClick={submit}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("community.createSubmit")}
      </Button>
    </Stack>
  );
}
