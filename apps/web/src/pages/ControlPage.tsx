import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { Link as RouterLink, useParams } from "react-router-dom";
import { EVENT_MODES, type EventMode } from "@eventer/shared";
import { useEvent, useEventEntries, useIsAdmin } from "../api/hooks.js";
import {
  useEventState,
  useScoreProgress,
  useScoreSummary,
  useSetMode,
  useSetPresenting,
  useToggleScoringLock,
} from "../api/scoringHooks.js";
import { useAwards } from "../api/awardHooks.js";
import { roleLabel } from "../lib/format.js";
import { EventBreadcrumbs } from "../components/EventBreadcrumbs.js";
import { UserLink } from "../components/UserLink.js";
import { useEntryUserResolver } from "../lib/entryUser.js";

const modeLabel: Record<EventMode, string> = {
  normal: "通常",
  presentation: "プレゼン",
  aggregation: "集計",
  awards: "表彰",
};

export function ControlPage() {
  const { id = "" } = useParams();
  const { data: eventData } = useEvent(id);
  const { data: state } = useEventState(id);
  const { data: entries } = useEventEntries(id);
  const resolveUser = useEntryUserResolver(id);
  const setMode = useSetMode(id);
  const setPresenting = useSetPresenting(id);
  const toggleLock = useToggleScoringLock(id);

  const isAdmin = useIsAdmin();
  const isStaff = eventData?.myRole === "staff" || isAdmin;
  const { data: summary } = useScoreSummary(id, Boolean(isStaff));
  const { data: progress } = useScoreProgress(id, Boolean(isStaff));
  const { data: awards } = useAwards(id);

  if (!eventData || !state || !entries) {
    return <Typography>読み込み中…</Typography>;
  }
  if (!isStaff) {
    return <Alert severity="info">進行コントロールはスタッフ専用です。</Alert>;
  }

  return (
    <Stack spacing={3}>
      <EventBreadcrumbs
        eventId={id}
        eventTitle={eventData.event.title}
        current="進行コントロール"
      />
      <Typography variant="h5" fontWeight={700}>
        進行コントロール
      </Typography>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          variant="contained"
          component={RouterLink}
          to={`/events/${id}/scoring`}
        >
          採点画面へ
        </Button>
        {state.mode === "presentation" && (
          <Button
            variant="outlined"
            color="error"
            component={RouterLink}
            to={`/events/${id}/present`}
          >
            プレゼン画面へ
          </Button>
        )}
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            モード
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {EVENT_MODES.map((m) => (
              <Button
                key={m}
                variant={state.mode === m ? "contained" : "outlined"}
                onClick={() => setMode.mutate(m)}
              >
                {modeLabel[m]}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            発表中のチーム
          </Typography>
          <TextField
            select
            fullWidth
            value={state.presentingEntryId ?? ""}
            onChange={(e) =>
              setPresenting.mutate(e.target.value === "" ? null : e.target.value)
            }
          >
            <MenuItem value="">（未選択）</MenuItem>
            {entries.map((en) => (
              <MenuItem key={en.id} value={en.id}>
                {en.name}
              </MenuItem>
            ))}
          </TextField>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">採点の締切</Typography>
              <Chip
                size="small"
                color={state.scoringLocked ? "error" : "success"}
                label={state.scoringLocked ? "締切済み" : "受付中"}
              />
            </Box>
            <Button
              variant="outlined"
              color={state.scoringLocked ? "success" : "error"}
              onClick={() => toggleLock.mutate()}
            >
              {state.scoringLocked ? "採点を再開" : "採点を締め切る"}
            </Button>
          </Stack>
          {state.scoringLocked && (
            <Box sx={{ mt: 2 }}>
              <Alert
                severity="success"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    component={RouterLink}
                    to={`/events/${id}/edit`}
                  >
                    受賞者を設定する
                  </Button>
                }
              >
                採点を締め切りました。受賞者を設定して表彰の準備をしましょう。
              </Alert>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            採点進捗
          </Typography>
          {progress?.judges.length === 0 ? (
            <Typography color="text.secondary">採点者がいません</Typography>
          ) : (
            <Stack spacing={1.5}>
              {progress?.judges.map((j) => (
                <Box key={j.userId}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">
                      {j.name}（{roleLabel[j.role as keyof typeof roleLabel] ?? j.role}）
                    </Typography>
                    <Typography
                      variant="body2"
                      color={j.complete ? "success.main" : "text.secondary"}
                    >
                      {j.filled}/{j.total}
                      {j.complete && (
                        <CheckIcon
                          fontSize="inherit"
                          sx={{ verticalAlign: "text-bottom", ml: 0.5 }}
                        />
                      )}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={j.total > 0 ? (j.filled / j.total) * 100 : 0}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            集計プレビュー
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>チーム</TableCell>
                {summary?.criteria.map((c) => (
                  <TableCell key={c.id} align="right">
                    {c.name}
                  </TableCell>
                ))}
                <TableCell align="right">合計</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary?.entries.map((e) => (
                <TableRow key={e.entryId}>
                  <TableCell>
                    <UserLink
                      username={resolveUser(e.entryId)?.username}
                      name={e.entryName}
                    />
                  </TableCell>
                  {summary.criteria.map((c) => (
                    <TableCell key={c.id} align="right">
                      {e.perCriterion[c.id] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <strong>{e.total}</strong>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            表彰
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            ① 受賞者を設定 → ② 表彰モードに切替（参加者は自動で表彰画面へ）→ ③
            表彰式画面で1件ずつ発表します。
          </Typography>
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="①" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                受賞者を設定（{awards ? awards.results.length : 0}/
                {awards ? awards.ranks.length + awards.specials.length : 0} 賞）
              </Typography>
              <Button
                size="small"
                variant="outlined"
                component={RouterLink}
                to={`/events/${id}/edit`}
              >
                受賞者を設定
              </Button>
            </Stack>

            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="②" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                表彰モードにする
                {state.mode === "awards" && "（現在このモード）"}
              </Typography>
              <Button
                size="small"
                variant={state.mode === "awards" ? "contained" : "outlined"}
                disabled={state.mode === "awards"}
                onClick={() => setMode.mutate("awards")}
              >
                表彰モードにする
              </Button>
            </Stack>

            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Chip size="small" label="③" />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                表彰式を進行（この画面が参加者にも映ります）
              </Typography>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                component={RouterLink}
                to={`/events/${id}/awards`}
              >
                表彰式の操作へ
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
