import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import OpenInFullOutlinedIcon from "@mui/icons-material/OpenInFullOutlined";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ChatMember, Event, EventRole } from "@eventer/shared";
import {
  CHAT_MESSAGE_MAX,
  chatWriteWindow,
  isWithinChatWriteWindow,
} from "@eventer/shared";
import { useMe } from "../api/hooks.js";
import {
  useChatMembers,
  useHideChatNote,
  useResetChatChannel,
} from "../api/eventChatHooks.js";
import {
  useEncryptedChat,
  useOpenEncryptedChat,
} from "../api/encryptedChatHooks.js";
import { isChatUnavailable } from "../lib/chatApiErrors.js";
import {
  clampToDisplayMax,
  selectVisibleChatMessages,
} from "../lib/chatMessageBuffer.js";
import { randomLocalSigner } from "../lib/nostrChat.js";
import type { ChatSigner } from "../lib/nostrChat.js";
import { ChatComposer } from "./chat/ChatComposer.js";
import { ChatJoinPanel } from "./chat/ChatJoinPanel.js";
import { ChatMessageList, chatFontSizes } from "./chat/ChatMessageList.js";
import { useChatChannel } from "./chat/useChatChannel.js";
import { useChatSigner } from "./chat/useChatSigner.js";
import { useEncryptedChatChannel } from "./chat/useEncryptedChatChannel.js";

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
 *
 * 参加者のみ（暗号化）(#582, docs/participant-encrypted-chat.md 4.2) のイベントでは
 * 経路を切り替える。暗号処理はここに書かない（chat/useEncryptedChatChannel.ts）:
 * - 新しい発言: 暗号化チャット（参加 UI は出さず、サーバー管理の一時鍵を自動発行）
 * - 平文の過去ログ（公開イベントのみ）: 既存の部屋を読み取り専用で開き、
 *   暗号化をオンにした時刻までの発言だけを同じ一覧に並べる（境目に区切り）
 * - 非公開・限定公開では平文の経路を一切開かない
 */
export function EventChat({
  eventId,
  event,
  myRole,
  variant = "card",
  fontScale = 1,
  showManagementActions = true,
}: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  /** card=イベントページ内のカード / page=専用ページで縦いっぱい /
   * display=投影用（見出し・入力欄・操作UIなしで本文だけを流す） (#215) */
  variant?: "card" | "page" | "display";
  /** display のときの文字サイズ倍率（投影距離に合わせて呼び出し側が変える） */
  fontScale?: number;
  showManagementActions?: boolean;
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
  const showStaffActions = isStaff && !display && showManagementActions;

  const encrypted = event.chatEncrypted;
  const isPublic = event.visibility === "public";
  // 平文の chat-members は公開イベントでだけ取る（非公開では 403 が返る経路。
  // 暗号化オンの公開イベントでは過去ログの名前解決に使う）
  const chatQuery = useChatMembers(eventId, isPublic);
  const { data: chat, error: chatError } = chatQuery;
  const enc = useEncryptedChat(eventId, encrypted);
  const openEnc = useOpenEncryptedChat(eventId);
  /** チャットに繋がせない状態か (#283)。
   *
   * **理由は画面に書かない**。「あなたは締め出されました」と伝えると、
   * 別の鍵を作って戻ってくるだけで意味がないため。
   * ただし「ネットワークが不調です」のような嘘も書かない。誤って締め出された人が
   * 回線を疑って時間を無駄にするし、後で分かったときに嘘をついたことになる。
   * 理由を明かさず、事実として正しい文言（`eventSocial.chatUnavailable`）だけを
   * 出す。理由は書かないが、嘘も書かない。 */
  const chatUnavailable = encrypted
    ? // 暗号化チャットの可否は鍵配布のゲート（参加確定メンバー・締め出し・設定）が決める。
      // 平文の chat-members の失敗はここでは見ない（過去ログが出なくなるだけ）
      Boolean(enc.error) || openEnc.isError || !me
    : isChatUnavailable(chatError) || Boolean(chatError) || !me || !isPublic || chat?.chatEnabled === false;
  const resetChannel = useResetChatChannel(eventId);
  const hideNote = useHideChatNote(eventId);

  // 暗号化モードでは平文の鍵の選択・自動再参加をしない（chat を渡さない＝何もしない）
  const signerState = useChatSigner({
    eventId,
    display,
    chat: encrypted ? undefined : chat,
    me,
  });
  const { joinErrorKey } = signerState;
  // 平文の過去ログは読むだけ。リレーの AUTH に答えるための使い捨て鍵で繋ぐ
  const legacyReaderRef = useRef<ChatSigner | null>(null);
  if (encrypted && !legacyReaderRef.current) {
    legacyReaderRef.current = randomLocalSigner();
  }
  const plaintextChannelId = enc.data?.plaintextChannelId ?? null;
  const signer = encrypted ? null : signerState.signer;
  // 部屋の開設はスタッフの操作 (#221)。投影用は見せるだけなので開設もしない。
  // 暗号化モードでは平文の部屋を開かない（サーバーも 409 で断る）
  const canOpenChannel = isStaff && !display && showManagementActions && !encrypted;
  const plain = useChatChannel({
    eventId,
    eventTitle: event.title,
    chat:
      encrypted && chat ? { ...chat, channelId: plaintextChannelId } : chat,
    signer,
    activeSigner: encrypted ? legacyReaderRef.current : signerState.activeSigner,
    // 主催者本人が本人の鍵で参加しているときだけ、その鍵で部屋を開く (#199 / #460)
    isOrganizerNip07: () =>
      signerState.isNip07Ref.current && me?.id === event.createdBy,
    canOpenChannel,
    // 許可リストに無い人の発言で取り直す（新しく参加した人）。暗号化モードの
    // 平文の過去ログは読むだけで新しい人は増えないので取り直さない
    refetchChat: encrypted ? undefined : () => chatQuery.refetch(),
    // 非公開・限定公開では平文の経路を一切開かない（plaintextChannelId も null）
    chatUnavailable:
      chatUnavailable || (encrypted && (!isPublic || !plaintextChannelId)),
  });
  const { channelId, channelErrorKey } = plain;

  // 部屋・自分の鍵が無ければ作る（先勝ち・冪等）。失効から復帰した人も
  // myKey が null で返るのでここで再有効化される。投影用は発言しないので作らない。
  // 失敗したらループしない（mutation がエラーのまま止まり、繋がせない表示に倒す）
  useEffect(() => {
    if (!encrypted || display || !me || !enc.isSuccess) return;
    if (openEnc.isPending || openEnc.isError) return;
    if (enc.data !== null && enc.data.myKey !== null) return;
    openEnc.mutate();
    // openEnc（mutation オブジェクト）は毎レンダーで変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encrypted, display, me, enc.isSuccess, enc.data, openEnc.isPending, openEnc.isError]);

  const encChannel = useEncryptedChatChannel({
    eventId,
    chat: encrypted ? enc.data : null,
    display,
    chatUnavailable: !encrypted || chatUnavailable,
    // 送信直前の取り直し（設計 3.2）。資格を失っていれば失敗して送らない
    refresh: async () => {
      const result = await enc.refetch();
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const relayConnected = encrypted ? encChannel.relayConnected : plain.relayConnected;

  // 書き込める期間 (#578)。主催者が選んだ期間をサーバーが共有の chatWriteWindow で
  // 計算してチャットのペイロードに載せている（取り直したときに設定変更も届く）。
  // ペイロードが届く前は同じ関数でイベントから計算する。1分ごとに再評価。
  // 日程が確定していること自体は呼び出し側の chatAvailable が保証している
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const writeWindow =
    (encrypted ? enc.data?.writeWindow : chat?.writeWindow) ??
    chatWriteWindow(event);
  const inWriteWindow = isWithinChatWriteWindow(writeWindow, now);

  const memberByPubkey = useMemo(() => {
    const map = new Map<string, ChatMember>(
      (chat?.members ?? []).map((m) => [m.pubkey, m]),
    );
    if (encrypted) {
      for (const m of enc.data?.members ?? []) map.set(m.pubkey, m);
    }
    return map;
  }, [chat, encrypted, enc.data]);
  const encryptedAt = enc.data?.encryptedAt ?? 0;
  /** 平文の過去ログ（暗号化モードのとき、オンにした時刻まで）。区切りを出すために別に持つ */
  const legacyMessages = useMemo(
    () =>
      encrypted
        ? selectVisibleChatMessages(
            plain.messages.filter((m) => m.created_at * 1000 <= encryptedAt),
            {
              members: new Set((chat?.members ?? []).map((m) => m.pubkey)),
              hidden: new Set(chat?.hiddenNoteIds ?? []),
              maxLength: CHAT_MESSAGE_MAX,
            },
          )
        : [],
    [encrypted, plain.messages, encryptedAt, chat],
  );
  const visibleMessages = useMemo(() => {
    if (!encrypted) {
      return selectVisibleChatMessages(plain.messages, {
        members: new Set(memberByPubkey.keys()),
        hidden: new Set(chat?.hiddenNoteIds ?? []),
        maxLength: CHAT_MESSAGE_MAX,
      });
    }
    const sealed = selectVisibleChatMessages(encChannel.messages, {
      members: new Set((enc.data?.members ?? []).map((m) => m.pubkey)),
      hidden: new Set(enc.data?.hiddenNoteIds ?? []),
      maxLength: CHAT_MESSAGE_MAX,
    });
    // 平文の過去ログと暗号文を created_at で1つの一覧にする（設計 4.2）
    return clampToDisplayMax(
      [...legacyMessages, ...sealed].sort((a, b) => a.created_at - b.created_at),
    );
  }, [encrypted, plain.messages, memberByPubkey, chat, encChannel.messages, enc.data, legacyMessages]);
  // 区切り「ここから参加者のみ」は平文の過去ログがあるときだけ、その最後の行の後に出す。
  // 投影用には出さない（見せる画面なので。設計 7.2）
  const lastLegacyId = legacyMessages.at(-1)?.id;
  const separatorAfterId =
    encrypted && !display && lastLegacyId &&
    visibleMessages.some((m) => m.id === lastLegacyId)
      ? lastLegacyId
      : null;
  const send = encrypted ? encChannel.send : plain.send;
  const canSend = encrypted ? encChannel.canSend : Boolean(channelId);

  // サーバーに登録済みのチャンネルID（未開設は null。取り直しで反映）
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
      {/* 定期の取り直しはしない（D-POLL-MIN）ので、締め出しの解除などはここから
          取り直す。投影用には出さない（見せるだけの画面） */}
      {!display && me && (
        <Button
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            openEnc.reset();
            void (encrypted ? enc.refetch() : chatQuery.refetch());
          }}
        >
          {t("common.retry")}
        </Button>
      )}
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
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            variant="h6"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <ForumOutlinedIcon fontSize="small" />
            {t("eventSocial.chatHeading")}
          </Typography>
          {/* 参加者のみ・暗号化 (#582 設計 7.2)。投影用には出さない */}
          {encrypted && !display && (
            <Tooltip title={t("eventSocial.chatEncryptedNotice")}>
              <Chip
                size="small"
                variant="outlined"
                icon={<LockOutlinedIcon />}
                label={t("eventSocial.chatEncryptedChip")}
              />
            </Tooltip>
          )}
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {(signer || (encrypted && encChannel.canSend)) && (
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
      {!encrypted && !display && chat && !serverChannelId && !canOpenChannel ? (
        // 部屋の開設はスタッフの操作のみ (#221)。それまで参加UIは出さない
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("eventSocial.chatRoomNotOpenYet")}
        </Typography>
      ) : !encrypted && !display && !signer ? (
        <ChatJoinPanel
          keyMode={signerState.keyMode}
          onKeyModeChange={signerState.setKeyMode}
          onJoin={() => void signerState.join()}
          disabled={signerState.joining || !me}
          showRoomNotOpenNotice={
            showStaffActions && Boolean(chat) && !serverChannelId
          }
        />
      ) : encrypted && !display && !enc.data?.myKey ? (
        // 鍵の取得・発行中（初回の POST・失効からの復帰）。参加の操作は要らない
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("common.loading")}
        </Typography>
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
            separatorAfterId={separatorAfterId}
          />
          {/* 投影用は入力欄を出さない（読むだけの画面） (#215) */}
          {!display && (
            <ChatComposer
              inWriteWindow={inWriteWindow}
              writeWindow={writeWindow}
              now={now}
              canSend={canSend}
              notice={encrypted ? t("eventSocial.chatEncryptedNotice") : undefined}
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
