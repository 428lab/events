import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ReportGmailerrorredIcon from "@mui/icons-material/ReportGmailerrorred";
import {
  ABUSE_DETAIL_LABELS,
  ABUSE_RULE_DESCRIPTIONS,
  ABUSE_RULE_LABELS,
  ABUSE_RULES,
} from "@eventer/shared";
import type { AbuseFlag, AbuseRule } from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import {
  useAbuseAllowlist,
  useAbuseFlags,
  useAddAbuseAllowlist,
  useRemoveAbuseAllowlist,
  useReviewAbuseFlag,
} from "../api/abuseHooks.js";
import { UserLink } from "../components/UserLink.js";
import { formatDateTime } from "../lib/format.js";

/** 未知のルール名はそのまま表示する（将来追加分でも壊れないように） */
function ruleLabel(rule: string): string {
  return ABUSE_RULE_LABELS[rule as AbuseRule] ?? rule;
}

function ruleDescription(rule: string): string {
  return ABUSE_RULE_DESCRIPTIONS[rule as AbuseRule] ?? "";
}

/** detail は JSON文字列。日本語ラベルの「ラベル: 値」に整形して表示する。
 * 未知のキーはキー名のまま出す（ルール追加時に画面を直さなくてよいように） */
function detailText(detail: string): string {
  if (!detail) return "";
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(
          ([k, v]) =>
            `${ABUSE_DETAIL_LABELS[k] ?? k}: ${
              typeof v === "string" ? v : JSON.stringify(v)
            }`,
        )
        .join(" / ");
    }
  } catch {
    // 壊れた JSON はそのまま出す
  }
  return detail;
}

function FlagRow({ flag }: { flag: AbuseFlag }) {
  const review = useReviewAbuseFlag();
  const suppress = useAddAbuseAllowlist();
  const reviewed = flag.reviewedAt !== null;
  return (
    <TableRow hover>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {reviewed ? (
          <Chip size="small" label="確認済み" color="success" variant="outlined" />
        ) : (
          <Chip size="small" label="未確認" color="warning" />
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        <Tooltip title={ruleDescription(flag.rule)}>
          <span>{ruleLabel(flag.rule)}</span>
        </Tooltip>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {flag.subjectUserId === null ? (
          // signup_spike のようなサービス全体の検知は対象ユーザーがいない
          <Typography variant="body2" color="text.secondary">
            サービス全体
          </Typography>
        ) : (
          <Tooltip title={flag.subjectUserId}>
            <span>
              <UserLink
                username={flag.subjectHandle || null}
                name={flag.subjectHandle || flag.subjectUserId.slice(0, 8)}
              />
            </span>
          </Tooltip>
        )}
      </TableCell>
      <TableCell sx={{ fontSize: 13, minWidth: 220 }}>
        {detailText(flag.detail)}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {formatDateTime(flag.detectedAt)}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {reviewed ? (
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(flag.reviewedAt as number)}
            </Typography>
          ) : (
            <Button
              size="small"
              variant="outlined"
              disabled={review.isPending}
              onClick={() => review.mutate(flag.id)}
            >
              確認済みにする
            </Button>
          )}
          {/* 確認済みにしてもクールダウンが切れれば再検知される。毎週イベントを
              開く主催者のような正当なヘビーユーザーは、こちらで恒久的に除外する */}
          {flag.subjectUserId !== null && (
            <Tooltip title="今後このユーザーのこのルールは検知・通知しない（抑制リストに追加）">
              <span>
                <Button
                  size="small"
                  color="inherit"
                  disabled={suppress.isPending}
                  onClick={() =>
                    suppress.mutate({
                      userId: flag.subjectUserId as string,
                      rule: flag.rule,
                    })
                  }
                >
                  今後通知しない
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** 抑制リスト（検知の段階で落とす対象）の一覧と解除 */
function AllowlistCard({ enabled }: { enabled: boolean }) {
  const { data } = useAbuseAllowlist(enabled);
  const remove = useRemoveAbuseAllowlist();
  const entries = data?.entries ?? [];
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" fontWeight={700}>
            抑制リスト（{entries.length} 件）
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ここに入っている対象は<strong>検知の段階で落とす</strong>ため、記録も通知も出ません。
            毎週イベントを開く主催者のように「毎回出るが問題ない」と分かっている相手を入れてください。
            「確認済みにする」は1件を片付けるだけで、次に条件を満たせばまた出ます。
          </Typography>
          {entries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              まだありません。
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>対象</TableCell>
                    <TableCell>抑制するルール</TableCell>
                    <TableCell>メモ</TableCell>
                    <TableCell>追加日時</TableCell>
                    <TableCell>解除</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        <UserLink
                          username={e.handle || null}
                          name={e.handle || e.userId.slice(0, 8)}
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {e.rule === null ? (
                          <Chip size="small" label="すべて" variant="outlined" />
                        ) : (
                          ruleLabel(e.rule)
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 13 }}>{e.note}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        <Button
                          size="small"
                          color="inherit"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(e.id)}
                        >
                          解除
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** 管理者向け: 異常行動の「要確認」リスト (#259 PR2)。
 * ここに出るのは違反の断定ではない。文言は必ず「要確認」で通すこと */
export function AdminAbusePage() {
  const isAdmin = useIsAdmin();
  // 既定は未確認のみ（毎回すべてを見なくて済むように）
  const [filter, setFilter] = useState<"unreviewed" | "reviewed" | "all">(
    "unreviewed",
  );
  const [page, setPage] = useState(1);
  const reviewed =
    filter === "all" ? undefined : filter === "reviewed" ? true : false;
  const { data, isLoading } = useAbuseFlags(isAdmin, { reviewed, page });

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <Stack spacing={2.5}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <ReportGmailerrorredIcon fontSize="medium" />
        要確認
      </Typography>
      <Alert severity="info">
        日次バッチが「普段より件数が多い動き」を機械的に拾ったリストです。
        <strong>違反の判定ではありません。</strong>
        毎週イベントを開く主催者のような正当なヘビーユーザーも同じように出ます。
        中身を見て問題がなければ「確認済みにする」で片付けてください（自動的な制限は一切行いません）。
      </Alert>
      <Typography variant="body2" color="text.secondary">
        検知の内訳は
        {ABUSE_RULES.map((r) => ABUSE_RULE_LABELS[r]).join("・")}
        です。記録するのはユーザーIDとハンドル・件数のみで、メールアドレスや本文は含みません。
        1年経過した記録は自動削除されます。
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <TextField
                select
                size="small"
                label="表示"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value as typeof filter);
                  setPage(1);
                }}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="unreviewed">未確認のみ</MenuItem>
                <MenuItem value="reviewed">確認済みのみ</MenuItem>
                <MenuItem value="all">すべて</MenuItem>
              </TextField>
              {data && (
                <Typography variant="body2" color="text.secondary">
                  未確認 {data.unreviewed} 件
                </Typography>
              )}
            </Stack>

            {isLoading || !data ? (
              <Typography>読み込み中…</Typography>
            ) : data.flags.length === 0 ? (
              <Typography color="text.secondary">
                該当する記録はありません。
              </Typography>
            ) : (
              <>
                <Typography variant="caption" color="text.secondary">
                  全 {data.total} 件
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>状態</TableCell>
                        <TableCell>検知した内容</TableCell>
                        <TableCell>対象</TableCell>
                        <TableCell>内訳</TableCell>
                        <TableCell>検知日時</TableCell>
                        <TableCell>確認</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.flags.map((flag) => (
                        <FlagRow key={flag.id} flag={flag} />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {pageCount > 1 && (
                  <Box sx={{ display: "flex", justifyContent: "center" }}>
                    <Pagination
                      count={pageCount}
                      page={page}
                      onChange={(_e, p) => setPage(p)}
                      color="primary"
                    />
                  </Box>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      <AllowlistCard enabled={isAdmin} />
    </Stack>
  );
}
