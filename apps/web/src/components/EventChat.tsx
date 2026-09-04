import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import OpenInFullOutlinedIcon from "@mui/icons-material/OpenInFullOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ChatMember, Event, EventRole } from "@eventer/shared";
import {
  CHAT_MESSAGE_MAX,
  CHAT_WINDOW_AFTER_MS,
  CHAT_WINDOW_BEFORE_MS,
} from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useChatMembers,
  useHideChatNote,
  useResetChatChannel,
} from "../api/eventChatHooks.js";
import { isChatUnavailable } from "../lib/chatApiErrors.js";
import { selectVisibleChatMessages } from "../lib/chatMessageBuffer.js";
import { ChatComposer } from "./chat/ChatComposer.js";
import { ChatJoinPanel } from "./chat/ChatJoinPanel.js";
import { ChatMessageList, chatFontSizes } from "./chat/ChatMessageList.js";
import { useChatChannel } from "./chat/useChatChannel.js";
import { useChatSigner } from "./chat/useChatSigner.js";

/**
 * Nostrイベントチャット (#199)。NIP-28 パブリックチャットをブラウザから
 * ユーザー所有リレーへ直接読み書きする（サーバーはチャット本文を経由しない）。
 * 表示は許可リスト（chat-members が返す pubkey）のメッセージのみ。許可リストには
 * 1人につき「これまでに使った鍵」が全部載る (#332) ので、端末や発言の手段を
 * 変えても過去の自分の発言は表示され続ける。
 *
 * このファイルが持つのは**variant による見た目の出し分けと配線だけ** (#335)。
 * - 鍵の選択・参加・自動再参加 → chat/useChatSigner.ts
 * - 接続・部屋の確定・購読・送信 → chat/useChatChannel.ts
 * - 参加UI / 一覧 / 入力欄 → chat/ChatJoinPanel.tsx, ChatMessageList.tsx,
 *   ChatComposer.tsx
 *
 * **チャットを出してよいかの判定はここでは持たない**。呼び出し側が
 * `useEventChatAccess` の `chatAvailable` で囲む（同じ式を2か所に置かない）。
 */
export function EventChat({
  eventId,
  event,
  myRole,
  variant = "card",
  fontScale = 1,
}: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  /** card=イベントページ内のカード / page=専用ページで縦いっぱい /
   * display=投影用（見出し・入力欄・操作UIなしで本文だけを流す） (#215) */
  variant?: "card" | "page" | "display";
  /** display のときの文字サイズ倍率（投影距離に合わせて呼び出し側が変える） */
  fontScale?: number;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  // イベント配下のUIは myRole のみで判定（サイト管理者でも staff でなければ操作UIを出さない）。
  // Q&A 側の canModerate と同じ基準＝「そのイベントの staff メンバーであること」
  const isStaff = myRole === "staff";
  // 投影用は「見せるだけ」の画面 (#215)。人前のスクリーンに映るので、
  // 参加UI・入力欄・スタッフ用の操作UI（非表示ボタン、チャンネルの作り直し等）は出さない
  const display = variant === "display";
  const fullHeight = variant === "page" || display;
  /** スタッフ用の操作UIを出してよいか。**スタッフ向けのUIを足すときは必ずこの
   * フラグで囲むこと**（isStaff を直接見ると投影用画面に漏れる） */
  const showStaffActions = isStaff && !display;

  const { data: chat, error: chatError } = useChatMembers(eventId, true);
  /** チャットに繋がせない状態か (#283)。
   *
   * **理由は画面に書かない**。「あなたは締め出されました」と伝えると、
   * 別の鍵を作って戻ってくるだけで意味がないため。
   * ただし「ネットワークが不調です」のような嘘も書かない。誤って締め出された人が
   * 回線を疑って時間を無駄にするし、後で分かったときに嘘をついたことになる。
   * 理由を明かさず、事実として正しい文言（`eventSocial.chatUnavailable`）だけを
   * 出す。理由は書かないが、嘘も書かない。 */
  const chatUnavailable = isChatUnavailable(chatError);
  const resetChannel = useResetChatChannel(eventId);
  const hideNote = useHideChatNote(eventId);

  const signerState = useChatSigner({ eventId, display, chat, me });
  const { signer, activeSigner, joinErrorKey } = signerState;
  // 部屋の開設はスタッフの操作 (#221)。投影用は見せるだけなので開設もしない
  const canOpenChannel = isStaff && !display;
  const { messages, channelId, relayConnected, channelErrorKey, send } =
    useChatChannel({
      eventId,
      eventTitle: event.title,
      chat,
      signer,
      activeSigner,
      // 主催者本人が本人の鍵で参加しているときだけ、その鍵で部屋を開く (#199 / #460)
      isOrganizerNip07: () =>
        signerState.isNip07Ref.current && me?.id === event.createdBy,
      canOpenChannel,
      chatUnavailable,
    });

  // 書き込み可能時間帯（開始30分前〜終了2時間後）。1分ごとに再評価。
  // 日程が確定していること自体は呼び出し側の chatAvailable が保証している
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const inWriteWindow =
    now >= event.startsAt - CHAT_WINDOW_BEFORE_MS &&
    now <= event.endsAt + CHAT_WINDOW_AFTER_MS;

  const memberByPubkey = useMemo(
    () =>
      new Map<string, ChatMember>(
        (chat?.members ?? []).map((m) => [m.pubkey, m]),
      ),
    [chat],
  );
  const visibleMessages = useMemo(
    () =>
      selectVisibleChatMessages(messages, {
        members: new Set(memberByPubkey.keys()),
        hidden: new Set(chat?.hiddenNoteIds ?? []),
        maxLength: CHAT_MESSAGE_MAX,
      }),
    [messages, memberByPubkey, chat],
  );

  // サーバーに登録済みのチャンネルID（未開設は null。ポーリングで反映）
  const serverChannelId = chat?.channelId ?? null;
  const bodyFontSize = chatFontSizes(display, fontScale).body;
  // 参加の失敗と部屋の開設の失敗は同時には立たない（参加できていない人は
  // 接続も始まらない）ので、1つの枠で出す
  const errorMessage = joinErrorKey
    ? t(joinErrorKey)
    : channelErrorKey
      ? t(channelErrorKey)
      : null;

  /** 繋がせない状態 (#283) の表示。理由は書かない。
   * 参加ボタンも入力欄もメッセージ一覧も出さない（この分岐だけを出す）。
   * 投影用でも同じ文言を出す。「まだ表示できるメッセージがありません」は
   * この状況では事実に反するので、そちらに落とさない */
  const unavailable = (
    <Stack spacing={1} sx={{ mt: display ? 0 : 1 }}>
      {!display && (
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <ForumOutlinedIcon fontSize="small" />
          {t("eventSocial.chatHeading")}
        </Typography>
      )}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: bodyFontSize }}
      >
        {t("eventSocial.chatUnavailable")}
      </Typography>
    </Stack>
  );

  const content = chatUnavailable ? (
    unavailable
  ) : (
    <>
      {/* 投影用は見出しを出さない（画面いっぱいに本文だけを流す） (#215) */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 0.5, display: display ? "none" : undefined }}
      >
        <Typography
          variant="h6"
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          <ForumOutlinedIcon fontSize="small" />
          {t("eventSocial.chatHeading")}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {signer && (
            <Typography variant="caption" color="text.secondary">
              {relayConnected
                ? t("eventSocial.chatConnected")
                : t("eventSocial.chatOffline")}
            </Typography>
          )}
          {variant === "card" && (
            <Tooltip title={t("eventSocial.chatOpenInPage")}>
              <IconButton
                size="small"
                component={RouterLink}
                to={`/events/${eventId}/chat`}
                aria-label={t("eventSocial.chatOpenInPage")}
              >
                <OpenInFullOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* チャンネル作成の失敗は参加後（signer確定後）にも起きるため、分岐の外で表示する。
          投影用には出さない（リレーやkindの話を会場のスクリーンに映さない） */}
      {errorMessage && !display && (
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          action={
            showStaffActions ? (
              <Button
                size="small"
                color="inherit"
                disabled={resetChannel.isPending}
                onClick={() => {
                  if (window.confirm(t("eventSocial.chatResetChannelConfirm"))) {
                    resetChannel.mutate();
                  }
                }}
              >
                {t("eventSocial.chatResetChannel")}
              </Button>
            ) : undefined
          }
        >
          {errorMessage}
        </Alert>
      )}
      {/* 投影用はどちらの分岐にも入らず、常にメッセージ一覧だけを出す (#215)。
          参加操作は戻り先の通常のチャット画面に任せる */}
      {!display && chat && !serverChannelId && !isStaff ? (
        // 部屋の開設はスタッフの操作のみ (#221)。それまで参加UIは出さない
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("eventSocial.chatRoomNotOpenYet")}
        </Typography>
      ) : !display && !signer ? (
        <ChatJoinPanel
          keyMode={signerState.keyMode}
          onKeyModeChange={signerState.setKeyMode}
          onJoin={() => void signerState.join()}
          disabled={signerState.joining || !me}
          showRoomNotOpenNotice={
            showStaffActions && Boolean(chat) && !serverChannelId
          }
        />
      ) : (
        <Stack
          spacing={1.5}
          sx={{
            mt: 1,
            ...(fullHeight ? { flex: 1, minHeight: 0 } : {}),
          }}
        >
          <ChatMessageList
            messages={visibleMessages}
            memberByPubkey={memberByPubkey}
            display={display}
            fontScale={fontScale}
            fullHeight={fullHeight}
            urlsAllowed={event.chatUrlsAllowed}
            showStaffActions={showStaffActions}
            hidePending={hideNote.isPending}
            onHide={(noteId) => hideNote.mutate(noteId)}
          />
          {/* 投影用は入力欄を出さない（読むだけの画面） (#215) */}
          {!display && (
            <ChatComposer
              inWriteWindow={inWriteWindow}
              canSend={Boolean(channelId)}
              // スタッフはURL投稿の制限を受けない (#241)
              allowUrls={isStaff || event.chatUrlsAllowed}
              onSend={send}
            />
          )}
        </Stack>
      )}
    </>
  );

  // 専用ページ・投影用 (#215) では Card を使わず、親のflex列の残り高さいっぱいに広げる
  return fullHeight ? (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {content}
    </Box>
  ) : (
    <Card variant="outlined">
      <CardContent>{content}</CardContent>
    </Card>
  );
}
