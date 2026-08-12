import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseFullscreenOutlinedIcon from "@mui/icons-material/CloseFullscreenOutlined";
import TextDecreaseIcon from "@mui/icons-material/TextDecrease";
import TextIncreaseIcon from "@mui/icons-material/TextIncrease";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEventQa } from "../api/eventQaHooks.js";
import { QaPickedQuestion } from "../components/QaQuestionList.js";
import { useEventChatAccess } from "../lib/useEventChatAccess.js";

// nostr-tools（暗号ライブラリ）が大きいため遅延読み込みで分離する（チャット専用ページと同様）
const EventChat = lazy(() =>
  import("../components/EventChat.js").then((m) => ({ default: m.EventChat })),
);

/** 文字サイズ倍率。投影距離に合わせてスタッフが変えられるようにしてある */
const SCALE_KEY = "eventer:chatScreenScale";
const SCALES = [0.8, 1, 1.25, 1.5, 2];

function readScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * 投影用画面 (#215)。プロジェクター投影やウィンドウキャプチャで使う想定で、
 * 見出し・入力欄・操作UIを出さず、大きめの文字でメッセージだけを流す。
 * ピックアップされた質問 (#216) があれば上部に大きく出す。
 * 権限は従来のチャットと同じ（参加確定メンバー。スタッフが開く想定）。
 */
export function EventChatScreenPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const { event, myRole, canChat, chatAvailable, isLoading, isError } =
    useEventChatAccess(id);
  // ピックアップされた質問だけを出す（一覧や操作UIは投影しない）。
  // Q&A を OFF にしたら投影からも消える（詳細画面から Q&A セクションが
  // 消えるので、残っていると外す手段が分かりにくい）
  const { data: qa } = useEventQa(id, canChat);
  const picked =
    (qa?.qaEnabled
      ? qa.questions.find((q) => q.id === qa.pickedQuestionId)
      : null) ?? null;

  const [scale, setScale] = useState(readScale);
  const changeScale = (dir: 1 | -1) => {
    const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale) + dir))];
    setScale(next);
    try {
      localStorage.setItem(SCALE_KEY, String(next));
    } catch {
      // localStorage 不可の環境ではセッション内のみ反映
    }
  };

  // カーソル自動非表示（3秒）。配信画面 (LiveScreenPage) と同じ作り
  const [cursorVisible, setCursorVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setCursorVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setCursorVisible(false), 3000);
  };
  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <Box
      // マウスの無い端末・キーボード操作でもコントロールを呼び戻せるようにする
      onMouseMove={wake}
      onTouchStart={wake}
      onKeyDown={wake}
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
        cursor: cursorVisible ? "default" : "none",
        zIndex: 2000,
        p: 3,
      }}
    >
      {isLoading ? (
        <Typography color="text.secondary">{t("common.loading")}</Typography>
      ) : isError || !event ? (
        <Alert severity="error">{t("eventSocial.chatEventNotFound")}</Alert>
      ) : !canChat ? (
        <Alert severity="info">
          {t("eventSocial.screenMembersOnly")}
        </Alert>
      ) : (
        <>
          {picked && (
            <Box
              sx={{
                flexShrink: 0,
                maxHeight: "45%",
                overflowY: "auto",
                py: 3,
                mb: 2,
                borderRadius: 2,
                bgcolor: "action.hover",
              }}
            >
              {/* 投影なので解除ボタン等のスタッフ操作は出さない。
                  匿名投稿の投稿者名も出さない（QaPickedQuestion は匿名なら
                  常に「匿名」表示。revealAuthor 相当の指定は絶対に渡さないこと） */}
              <QaPickedQuestion question={picked} scale={1.6 * scale} />
            </Box>
          )}
          {/* チャットを使わない（Q&Aだけ有効な）イベントでも質問は投影できるよう、
              条件はチャット部分にだけかける */}
          {chatAvailable ? (
            <Suspense fallback={null}>
              <EventChat
                eventId={id}
                event={event}
                myRole={myRole}
                canChat={canChat}
                variant="display"
                fontScale={scale}
              />
            </Suspense>
          ) : (
            // 質問を投影しているときは、案内でスクリーンを埋めない
            !picked && (
              <Typography color="text.secondary">
                {t("eventSocial.screenChatUnavailable")}
              </Typography>
            )
          )}
        </>
      )}

      {/* 操作は投影に写り込まないようカーソル表示中だけ右下に出す */}
      {cursorVisible && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ position: "fixed", right: 8, bottom: 8, opacity: 0.5 }}
        >
          <Tooltip title={t("eventSocial.screenTextSmaller")}>
            <span>
              <IconButton
                size="small"
                disabled={scale === SCALES[0]}
                onClick={() => changeScale(-1)}
                aria-label={t("eventSocial.screenTextSmaller")}
              >
                <TextDecreaseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("eventSocial.screenTextLarger")}>
            <span>
              <IconButton
                size="small"
                disabled={scale === SCALES[SCALES.length - 1]}
                onClick={() => changeScale(1)}
                aria-label={t("eventSocial.screenTextLarger")}
              >
                <TextIncreaseIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t("eventSocial.screenBackToChat")}>
            <IconButton
              size="small"
              component={RouterLink}
              to={`/events/${id}/chat`}
              aria-label={t("eventSocial.screenBackToChat")}
            >
              <CloseFullscreenOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Box>
  );
}
