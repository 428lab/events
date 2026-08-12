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
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import ThumbUpOffAltIcon from "@mui/icons-material/ThumbUpOffAlt";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
   * サーバーが返す canModerate をそのまま渡すこと（＝そのイベントの参加確定
   * staff メンバーだけ。画面側で条件を書き直すとサーバーの認可とズレる） */
  isStaff?: boolean;
  /**
   * **匿名投稿**の投稿者名を出してよい画面か。既定 false（＝渡さなければ出さない）。
   *
   * 匿名投稿の author はイベントのスタッフにだけ届く。スタッフのアカウントで
   * 投影画面や登壇者のサイドパネル (#215) を開くことがあるので、既定で出すと
   * 匿名で聞いた人の実名がスクリーンに映ってしまう。**人に見せる画面では渡さないこと**。
   * 渡してよいのは本人だけが見ているイベント詳細内のQ&A（サーバーの
   * `revealsAuthor` をそのまま渡す）。
   *
   * 実名投稿の投稿者名は元から全員に公開なので、この指定に関わらず表示する。
   */
  revealAuthor?: boolean;
  /**
   * 自分の投稿に「自分」チップを出すか。既定 true。
   *
   * 人に見せる画面では false にすること。登壇者のサイドパネル (#215) は
   * 画面共有されることがあり、登壇者自身が匿名で投げた質問にチップが付くと
   * 「匿名」と並んで誰の質問か分かってしまう。
   */
  showMineChip?: boolean;
  onVote?: (question: EventQuestion, voted: boolean) => void;
  onAnswered?: (question: EventQuestion, answered: boolean) => void;
  onHidden?: (question: EventQuestion, hidden: boolean) => void;
  /** ピックアップの設定・解除（null で解除） */
  onPick?: (questionId: string | null) => void;
  /** 自分の質問の取り消し（mine の質問にだけ出る。確認は呼び出し側で取る） */
  onDelete?: (question: EventQuestion) => void;
  /** 余白を詰める（サイドパネル向け） */
  dense?: boolean;
  /** 空のときの文言。省略すると「まだ質問はありません。」 */
}

/** 匿名投稿で表示してよい投稿者を返す。
 * 匿名投稿の author はスタッフにしか届かないので、revealAuthor を明示された
 * 画面でだけ出す（既定は出さない）。実名投稿はこの関数を通さない */
function anonymousAuthor(question: EventQuestion, revealAuthor?: boolean) {
  return revealAuthor ? question.author : null;
}

/** 投稿者の表示。匿名投稿は名前を出さない
 * （revealAuthor のときだけスタッフに届いた投稿者を添える） */
function QaAuthorLine({
  question,
  revealAuthor,
  showMineChip = true,
  dense,
}: {
  question: EventQuestion;
  revealAuthor?: boolean;
  showMineChip?: boolean;
  dense?: boolean;
}) {
  const { t } = useTranslation();
  const anonymous = question.anonymous;
  const author = anonymous
    ? anonymousAuthor(question, revealAuthor)
    : question.author;
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
            {t("eventSocial.qaAnonymous")}
          </Typography>
          {author && (
            // 匿名投稿でも荒らし対応のためスタッフには投稿者が届く
            <Tooltip title={t("eventSocial.qaAuthorStaffOnly")}>
              <Typography
                variant="caption"
                color="text.secondary"
                component={RouterLink}
                to={`/users/${author.username}`}
                sx={{ textDecoration: "none" }}
              >
                {t("common.parenName", { name: author.name })}
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
          {author?.name ?? t("eventSocial.qaAuthorUnknown")}
        </Typography>
      )}
      {question.mine && showMineChip && (
        <Chip
          size="small"
          label={t("eventSocial.qaMine")}
          variant="outlined"
        />
      )}
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
  revealAuthor = false,
  showMineChip = true,
  onVote,
  onAnswered,
  onHidden,
  onPick,
  onDelete,
  dense,
}: {
  question: EventQuestion;
  picked?: boolean;
} & Omit<QaQuestionListProps, "questions" | "pickedQuestionId">) {
  const { t } = useTranslation();
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
            title={
              question.votedByMe
                ? t("eventSocial.qaUnvote")
                : t("eventSocial.qaVote")
            }
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
                label={t("eventSocial.qaPicked")}
              />
            )}
            {question.answered && (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<CheckCircleIcon />}
                label={t("eventSocial.qaAnswered")}
              />
            )}
            {question.hidden && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                icon={<VisibilityOffOutlinedIcon />}
                label={t("eventSocial.qaHidden")}
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
            <QaAuthorLine
              question={question}
              revealAuthor={revealAuthor}
              showMineChip={showMineChip}
              dense={dense}
            />
          </Box>
        </Box>

        {(isStaff || (question.mine && onDelete)) && (
          <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
            {isStaff && onPick && (
              <IconButton
                size="small"
                color={picked ? "primary" : "default"}
                disabled={question.hidden}
                onClick={() => onPick(picked ? null : question.id)}
                title={
                  picked ? t("eventSocial.qaUnpick") : t("eventSocial.qaPick")
                }
              >
                <CampaignOutlinedIcon fontSize="small" />
              </IconButton>
            )}
            {isStaff && onAnswered && (
              <IconButton
                size="small"
                color={question.answered ? "success" : "default"}
                onClick={() => onAnswered(question, !question.answered)}
                title={
                  question.answered
                    ? t("eventSocial.qaMarkUnanswered")
                    : t("eventSocial.qaMarkAnswered")
                }
              >
                {question.answered ? (
                  <CheckCircleIcon fontSize="small" />
                ) : (
                  <CheckCircleOutlineIcon fontSize="small" />
                )}
              </IconButton>
            )}
            {isStaff && onHidden && (
              <IconButton
                size="small"
                color={question.hidden ? "warning" : "default"}
                onClick={() => onHidden(question, !question.hidden)}
                title={
                  question.hidden
                    ? t("eventSocial.qaUnhide")
                    : t("eventSocial.qaHide")
                }
              >
                {question.hidden ? (
                  <VisibilityOutlinedIcon fontSize="small" />
                ) : (
                  <VisibilityOffOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            )}
            {/* 自分の質問は自分で取り消せる（実名で出すつもりがなかった等の自助手段） */}
            {question.mine && onDelete && (
              <IconButton
                size="small"
                onClick={() => onDelete(question)}
                title={t("eventSocial.qaDeleteMine")}
              >
                <DeleteOutlineIcon fontSize="small" />
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
  ...itemProps
}: QaQuestionListProps) {
  const { t } = useTranslation();
  const open = questions.filter((q) => !q.answered);
  const answered = questions.filter((q) => q.answered);
  if (questions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("eventSocial.qaEmpty")}
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
              {t("eventSocial.qaAnsweredCount", { n: answered.length })}
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
  revealAuthor = false,
  onClear,
}: {
  question: EventQuestion;
  /** 文字サイズの倍率（投影は大きく、サイドパネルは等倍） */
  scale?: number;
  /** 匿名投稿の投稿者名を出してよいか。既定 false。
   * 投影画面はスタッフのアカウントで開くので、渡さないこと
   * （QaQuestionListProps.revealAuthor と同じ意味） */
  revealAuthor?: boolean;
  /** 解除ボタンを出す場合のハンドラ（staff のみ） */
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const anonAuthor = anonymousAuthor(question, revealAuthor);
  return (
    <Box sx={{ textAlign: "center", px: 2 }}>
      <Chip
        color="primary"
        icon={<CampaignOutlinedIcon />}
        label={t("eventSocial.qaPicked")}
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
          // 1票のときは英語の単数形にする（画面は数だけを見てキーを選ぶ）
          label={t(
            question.votes === 1
              ? "eventSocial.qaVoteOne"
              : "eventSocial.qaVotes",
            { n: question.votes },
          )}
        />
        <Typography variant="body2" color="text.secondary">
          {question.anonymous
            ? anonAuthor
              ? t("eventSocial.qaAnonWithAuthor", { name: anonAuthor.name })
              : t("eventSocial.qaAnonymous")
            : (question.author?.name ?? t("eventSocial.qaAuthorUnknown"))}
        </Typography>
      </Stack>
      {onClear && (
        <Button size="small" sx={{ mt: 2 }} onClick={onClear}>
          {t("eventSocial.qaUnpick")}
        </Button>
      )}
    </Box>
  );
}
