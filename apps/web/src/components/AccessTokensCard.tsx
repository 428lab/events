import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import {
  ACCESS_TOKEN_DEFAULT_EXPIRY_DAYS,
  ACCESS_TOKEN_EXPIRY_DAYS,
  ACCESS_TOKEN_MAX_ACTIVE,
  ACCESS_TOKEN_NAME_MAX,
  type AccessToken,
  type AccessTokenExpiryDays,
  type CreatedAccessToken,
} from "@eventer/shared";
import {
  useAccessTokens,
  useCreateAccessToken,
  useRevokeAccessToken,
} from "../api/userHooks.js";
import { errorCode } from "../lib/errorMessage.js";
import { formatDateTime } from "../lib/format.js";

/** MCP エンドポイントの URL。いま開いている環境（本番 / staging / ローカル）に合わせる */
function mcpUrl(): string {
  return `${window.location.origin}/api/mcp`;
}

/** Claude Code の接続コマンド（docs/ai-integration.md §6.6）。トークンを埋めた形 */
export function claudeCodeCommand(token: string, url = mcpUrl()): string {
  return `claude mcp add --transport http events-lab ${url} --header "Authorization: Bearer ${token}"`;
}

/** 読み取り専用の1行 + コピーボタン。平文トークン・コマンド・URL で共用 */
function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // コピー不可の環境ではテキストを手動選択してもらう
    }
  };
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        size="small"
        fullWidth
        label={label}
        value={value}
        slotProps={{
          input: {
            readOnly: true,
            sx: { fontFamily: "monospace", fontSize: 13 },
          },
        }}
        onFocus={(e) => e.target.select()}
      />
      <Button
        size="small"
        startIcon={<ContentCopyIcon />}
        onClick={copy}
        aria-label={`${t("accessTokens.copy")}: ${label}`}
        sx={{ flexShrink: 0 }}
      >
        {copied ? t("common.copied") : t("accessTokens.copy")}
      </Button>
    </Stack>
  );
}

/** 一覧の1行。失効済み・期限切れは薄く出し、失効ボタンを出さない */
function TokenRow({
  token,
  now,
  onRevoke,
}: {
  token: AccessToken;
  now: number;
  onRevoke: (token: AccessToken) => void;
}) {
  const { t } = useTranslation();
  const revoked = token.revokedAt !== null;
  const expired = !revoked && token.expiresAt < now;
  const inactive = revoked || expired;
  return (
    <Box
      data-testid={`access-token-${token.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
        opacity: inactive ? 0.5 : 1,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography sx={{ wordBreak: "break-all" }}>{token.name}</Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontFamily: "monospace" }}
          >
            {token.prefix}…
          </Typography>
          <Chip
            size="small"
            label={
              token.scopes.includes("write")
                ? t("accessTokens.scopeWrite")
                : t("accessTokens.scopeRead")
            }
          />
          {revoked && <Chip size="small" label={t("accessTokens.revokedChip")} />}
          {expired && <Chip size="small" label={t("accessTokens.expiredChip")} />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {t("accessTokens.createdAt", { date: formatDateTime(token.createdAt) })}
          {" / "}
          {t("accessTokens.expiresAt", { date: formatDateTime(token.expiresAt) })}
          {" / "}
          {token.lastUsedAt !== null
            ? t("accessTokens.lastUsedAt", {
                date: formatDateTime(token.lastUsedAt),
              })
            : t("accessTokens.neverUsed")}
        </Typography>
      </Box>
      {!inactive && (
        <Button
          size="small"
          color="error"
          variant="outlined"
          onClick={() => onRevoke(token)}
        >
          {t("accessTokens.revoke")}
        </Button>
      )}
    </Box>
  );
}

/** 発行直後の1回だけの表示。平文と Claude 側の接続手順（§6.6） */
function IssuedTokenView({ issued }: { issued: CreatedAccessToken }) {
  const { t } = useTranslation();
  const url = mcpUrl();
  return (
    <Stack spacing={2}>
      <Alert severity="warning">{t("accessTokens.issuedOnce")}</Alert>
      <CopyField label={t("accessTokens.tokenLabel")} value={issued.token} />

      <Stack spacing={1}>
        <Typography variant="subtitle2">
          {t("accessTokens.claudeCodeTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("accessTokens.claudeCodeHelp")}
        </Typography>
        <CopyField
          label="Claude Code"
          value={claudeCodeCommand(issued.token, url)}
        />
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle2">
          {t("accessTokens.claudeAiTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("accessTokens.claudeAiSteps")}
        </Typography>
        <CopyField label={t("accessTokens.mcpUrlLabel")} value={url} />
        <CopyField
          label={t("accessTokens.headerValueLabel")}
          value={`Bearer ${issued.token}`}
        />
        <Typography variant="body2" color="text.secondary">
          {t("accessTokens.claudeAiNoHeaders")}
        </Typography>
      </Stack>
    </Stack>
  );
}

/** 「AI 連携（アクセストークン）」カード (#581)。アカウント設定の「ログイン方法」の直後に置く。
 * 設計は docs/ai-integration.md §4.7（設定 API）・§6.3（漏えい時）・§6.6（接続手順） */
export function AccessTokensCard() {
  const { t } = useTranslation();
  const { data: tokens } = useAccessTokens();
  const create = useCreateAccessToken();
  const revoke = useRevokeAccessToken();

  const [issueOpen, setIssueOpen] = useState(false);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<AccessTokenExpiryDays>(
    ACCESS_TOKEN_DEFAULT_EXPIRY_DAYS,
  );
  const [issueError, setIssueError] = useState<string | null>(null);
  // 平文はこの state にだけ持つ。ダイアログを閉じたら捨てる（二度と出さない）
  const [issued, setIssued] = useState<CreatedAccessToken | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<AccessToken | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const openIssue = () => {
    setName("");
    setWrite(false);
    setExpiresInDays(ACCESS_TOKEN_DEFAULT_EXPIRY_DAYS);
    setIssueError(null);
    setIssued(null);
    setIssueOpen(true);
  };

  // 平文は閉じ終わったところで捨てる（閉じる途中で発行フォームに戻って見えないように）
  const closeIssue = () => setIssueOpen(false);

  const runIssue = () => {
    setIssueError(null);
    create.mutate(
      { name: name.trim(), write, expiresInDays },
      {
        onSuccess: (data) => setIssued(data),
        onError: (e) =>
          setIssueError(
            errorCode(e) === "too_many_tokens"
              ? t("accessTokens.tooManyTokens", { max: ACCESS_TOKEN_MAX_ACTIVE })
              : t("accessTokens.issueFailed"),
          ),
      },
    );
  };

  const runRevoke = () => {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    setRevokeTarget(null);
    setRevokeError(null);
    revoke.mutate(id, {
      onError: () => setRevokeError(t("accessTokens.revokeFailed")),
    });
  };

  const now = Date.now();
  const trimmedName = name.trim();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t("accessTokens.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("accessTokens.description")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("accessTokens.leakNotice")}
        </Typography>

        {tokens && tokens.length > 0 ? (
          <Stack spacing={1.5} sx={{ mb: 2 }}>
            {tokens.map((tok) => (
              <TokenRow
                key={tok.id}
                token={tok}
                now={now}
                onRevoke={setRevokeTarget}
              />
            ))}
          </Stack>
        ) : tokens ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("accessTokens.empty")}
          </Typography>
        ) : null}

        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={openIssue}
        >
          {t("accessTokens.issue")}
        </Button>

        {revokeError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {revokeError}
          </Alert>
        )}
      </CardContent>

      {/* 発行。成功したら同じダイアログで平文を1回だけ見せる */}
      {/* 平文を見せている間は、背景のタップや Esc では閉じない（閉じたら二度と出せない） */}
      <Dialog
        open={issueOpen}
        onClose={() => {
          if (!issued) closeIssue();
        }}
        fullWidth
        maxWidth="sm"
        slotProps={{ transition: { onExited: () => setIssued(null) } }}
      >
        <DialogTitle>
          {issued ? t("accessTokens.issuedTitle") : t("accessTokens.issueTitle")}
        </DialogTitle>
        <DialogContent>
          {issued ? (
            <IssuedTokenView issued={issued} />
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                size="small"
                required
                autoFocus
                label={t("accessTokens.nameLabel")}
                helperText={t("accessTokens.nameHelp")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                slotProps={{ htmlInput: { maxLength: ACCESS_TOKEN_NAME_MAX } }}
              />
              <Box>
                <Typography variant="body2" color="text.secondary">
                  {t("accessTokens.scopeLabel")}
                </Typography>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={write}
                      onChange={(e) => setWrite(e.target.checked)}
                    />
                  }
                  label={t("accessTokens.writeLabel")}
                />
                {write && (
                  <Alert severity="warning">{t("accessTokens.writeHelp")}</Alert>
                )}
              </Box>
              <TextField
                select
                size="small"
                label={t("accessTokens.expiryLabel")}
                value={expiresInDays}
                onChange={(e) =>
                  setExpiresInDays(Number(e.target.value) as AccessTokenExpiryDays)
                }
                sx={{ maxWidth: 200 }}
              >
                {ACCESS_TOKEN_EXPIRY_DAYS.map((d) => (
                  <MenuItem key={d} value={d}>
                    {t("accessTokens.expiryDays", { n: d })}
                  </MenuItem>
                ))}
              </TextField>
              {issueError && <Alert severity="warning">{issueError}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {issued ? (
            <Button variant="contained" onClick={closeIssue}>
              {t("accessTokens.issuedDone")}
            </Button>
          ) : (
            <>
              <Button onClick={closeIssue}>{t("common.cancel")}</Button>
              <Button
                variant="contained"
                disabled={!trimmedName || create.isPending}
                onClick={runIssue}
              >
                {t("accessTokens.issueRun")}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* 失効は取り消せないので確認を挟む */}
      <Dialog open={Boolean(revokeTarget)} onClose={() => setRevokeTarget(null)}>
        <DialogTitle>{t("accessTokens.revokeTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {revokeTarget &&
              t("accessTokens.revokeBody", {
                name: revokeTarget.name,
                prefix: revokeTarget.prefix,
              })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={revoke.isPending}
            onClick={runRevoke}
          >
            {t("accessTokens.revokeRun")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
