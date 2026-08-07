import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Link as RouterLink } from "react-router-dom";
import type { EventQuestion } from "@eventer/shared";
import { formatDateTime } from "../lib/format.js";

/** Q&A (#216) の質問リスト。イベント詳細のセクション・投影用画面・
 * プレゼンターのサイドパネル (#215) から共通で使う表示コンポーネント。
 * データ取得は行わず、props で受け取ったものを描くだけにしてある。 */

export interface QaQuestionListProps {
  questions: EventQuestion[];
  /** 「いまこの質問」（ハイライト表示する） */
  pickedQuestionId?: string | null;
  /** 投票ボタンを出すか（参加確定メンバー＋Q&A有効） */
  canVote?: boolean;
  /** スタッフ操作（回答済み・非表示・ピックアップ）を出すか。
   * 呼び出し側が myRole === "staff" だけで判定すること */
  isStaff?: boolean;
  onVote?: (question: EventQuestion, voted: boolean) => void;
  onAnswered?: (question: EventQuestion, answered: boolean) => void;
  onHidden?: (question: EventQuestion, hidden: boolean) => void;
  /** ピックアップの設定・解除（null で解除） */
  onPick?: (questionId: string | null) => void;
  /** 余白を詰める（サイドパネル向け） */
  dense?: boolean;
  emptyText?: string;
}

/** 投稿者の表示。匿名投稿は名前を出さない（スタッフには author が入って届く） */
function QaAuthorLine({
  question,
  dense,
}: {
  question: EventQuestion;
  dense?: boolean;
}) {
  const anonymous = question.anonymous;
  const author = question.author;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
      <Avatar
        src={anonymous ? undefined : (author?.avatarUrl ?? undefined)}
        sx={{ width: dense ? 20 : 24, height: dense ? 20 : 24, fontSize: 12 }}
      >
        {anonymous ? "?" : (author?.name.charAt(0) ?? "?")}
      </Avatar>
      {anonymous ? (
        <>
          <Typography variant="caption" color="text.secondary">
            匿名
          </Typography>
          {author && (
            // 匿名投稿でも荒らし対応のためスタッフには投稿者が届く
            <Tooltip title="スタッフにだけ表示されています">
              <Typography
                variant="caption"
                color="text.secondary"
                component={RouterLink}
                to={`/users/${author.username}`}
                sx={{ textDecoration: "none" }}
              >
                （{author.name}）
              </Typography>
            </Tooltip>
          )}
        </>
      ) : (
        <Typography
          variant="caption"
          color="text.secondary"
          component={author ? RouterLink : "span"}
          to={author ? `/users/${author.username}` : undefined}
          sx={{ textDecoration: "none" }}
        >
          {author?.name ?? "不明"}
        </Typography>
      )}
      {question.mine && <Chip size="small" label="自分" variant="outlined" />}
      <Typography variant="caption" color="text.secondary">
        {formatDateTime(question.createdAt)}
      </Typography>
    </Stack>
  );
}

/** 質問1件。リスト以外（投影のサイド一覧など）からも単体で使える */
export function QaQuestionItem({
  question,
  picked,
  canVote,
  isStaff,
  onVote,
  onAnswered,
  onHidden,
  onPick,
  dense,
}: {
  question: EventQuestion;
  picked?: boolean;
} & Omit<QaQuestionListProps, "questions" | "pickedQuestionId" | "emptyText">) {
  return (
    <Box
      sx={{
        p: dense ? 1 : 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: picked ? "primary.main" : "divider",
        bgcolor: picked ? "action.hover" : undefined,
        opacity: question.answered ? 0.75 : 1,
      }}
    >
      <Stack direction="row" spacing={dense ? 1 : 1.5} alignItems="flex-start">
        {/* 票数と投票ボタン。押すと自分の1票を入れる/取り消す */}
        <Stack alignItems="center" sx={{ minWidth: 44 }}>
          <IconButton
            size="small"
            color={question.votedByMe ? "primary" : "default"}
            disabled={!canVote || !onVote}
            onClick={() => onVote?.(question, !question.votedByMe)}
            title={question.votedByMe ? "投票を取り消す" : "この質問に投票する"}
          >
            {question.votedByMe ? (
              <ThumbUpAltIcon fontSize="small" />
            ) : (
              <ThumbUpOffAltIcon fontSize="small" />
            )}
          </IconButton>
          <Typography variant="caption" fontWeight={700}>
            {question.votes}
          </Typography>
        </Stack>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} sx={{ mb: 0.25 }} flexWrap="wrap" useFlexGap>
            {picked && (
              <Chip
                size="small"
                color="primary"
                icon={<CampaignOutlinedIcon />}
                label="いまこの質問"
              />
            )}
            {question.answered && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<CheckCircleIcon />}
                label="回答済み"
              />
            )}
            {question.hidden && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                icon={<VisibilityOffOutlinedIcon />}
                label="非表示"
              />
            )}
          </Stack>
          <Typography
            variant={dense ? "body2" : "body1"}
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {question.body}
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            <QaAuthorLine question={question} dense={dense} />
          </Box>
        </Box>

        {isStaff && (
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
            {onPick && (
              <IconButton
                size="small"
                color={picked ? "primary" : "default"}
                disabled={question.hidden}
                onClick={() => onPick(picked ? null : question.id)}
                title={picked ? "ピックアップを解除" : "いまこの質問にする"}
              >
                <CampaignOutlinedIcon fontSize="small" />
              </IconButton>
            )}
            {onAnswered && (
              <IconButton
                size="small"
                color={question.answered ? "success" : "default"}
                onClick={() => onAnswered(question, !question.answered)}
                title={question.answered ? "未回答に戻す" : "回答済みにする"}
              >
                {question.answered ? (
                  <CheckCircleIcon fontSize="small" />
                ) : (
                  <CheckCircleOutlineIcon fontSize="small" />
                )}
              </IconButton>
            )}
            {onHidden && (
              <IconButton
                size="small"
                color={question.hidden ? "warning" : "default"}
                onClick={() => onHidden(question, !question.hidden)}
                title={question.hidden ? "非表示を解除" : "非表示にする"}
              >
                {question.hidden ? (
                  <VisibilityOutlinedIcon fontSize="small" />
                ) : (
                  <VisibilityOffOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

/** 未回答（票数順）→ 回答済み の順で並べる。並び自体はサーバーが決めている */
export function QaQuestionList({
  questions,
  pickedQuestionId = null,
  emptyText = "まだ質問はありません。",
  ...itemProps
}: QaQuestionListProps) {
  const open = questions.filter((q) => !q.answered);
  const answered = questions.filter((q) => q.answered);
  if (questions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    );
  }
  return (
    <Stack spacing={itemProps.dense ? 0.75 : 1}>
      {open.map((q) => (
        <QaQuestionItem
          key={q.id}
          question={q}
          picked={q.id === pickedQuestionId}
          {...itemProps}
        />
      ))}
      {answered.length > 0 && (
        <>
          <Divider textAlign="left" sx={{ pt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              回答済み（{answered.length}）
            </Typography>
          </Divider>
          {answered.map((q) => (
            <QaQuestionItem
              key={q.id}
              question={q}
              picked={q.id === pickedQuestionId}
              {...itemProps}
            />
          ))}
        </>
      )}
    </Stack>
  );
}

/** 「いまこの質問」を大きく出す（#215 の投影画面用）。
 * 未ピックアップのときは null を返さず案内を出すかは呼び出し側で決める */
export function QaPickedQuestion({
  question,
  scale = 1,
  onClear,
}: {
  question: EventQuestion;
  /** 文字サイズの倍率（投影は大きく、サイドパネルは等倍） */
  scale?: number;
  /** 解除ボタンを出す場合のハンドラ（staff のみ） */
  onClear?: () => void;
}) {
  return (
    <Box sx={{ textAlign: "center", px: 2 }}>
      <Chip
        color="primary"
        icon={<CampaignOutlinedIcon />}
        label="いまこの質問"
        sx={{ mb: 2 }}
      />
      <Typography
        sx={{
          fontSize: `${2 * scale}rem`,
          lineHeight: 1.5,
          fontWeight: 700,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {question.body}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        justifyContent="center"
        alignItems="center"
        sx={{ mt: 2 }}
      >
        <Chip
          size="small"
          icon={<ThumbUpAltIcon />}
          label={`${question.votes} 票`}
        />
        <Typography variant="body2" color="text.secondary">
          {question.anonymous ? "匿名" : (question.author?.name ?? "不明")}
        </Typography>
      </Stack>
      {onClear && (
        <Button size="small" sx={{ mt: 2 }} onClick={onClear}>
          ピックアップを解除
        </Button>
      )}
    </Box>
  );
}
