import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CHAT_MESSAGE_MAX,
  CHAT_RELAYS,
  GROUP_CHAT_KIND,
  splitByUrls,
} from "@eventer/shared";
import type { StaffChatMember } from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { ApiError } from "../api/client.js";
import { useOpenStaffChat, useStaffChat } from "../api/staffChatHooks.js";
import { ChatRelayPool, localSignerFromHex } from "../lib/nostrChat.js";
import type { ChatSigner } from "../lib/nostrChat.js";
import {
  openStaffChatMessage,
  sealStaffChatMessage,
  visibleAfterRevocation,
} from "../lib/staffChatCrypto.js";
import {
  appendChatMessage,
  bufferAllowPredicate,
  clampToDisplayMax,
} from "../lib/chatMessageBuffer.js";
import { formatChatTime } from "../lib/chatTime.js";
import { ChatUrlLink } from "./chat/ChatMessageBody.js";

/** 復号済みの本文。URLはリンク化のみ（スタッフ同士なので常にリンクにする。
 * インライン画像・投影用の装飾は持たない＝必要最小 #382 設計 9.2） */
function MessageBody({ text }: { text: string }) {
  return (
    <Typography
      variant="body2"
      sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {splitByUrls(text).map((tok, i) =>
        tok.type === "text" ? (
          <span key={i}>{tok.value}</span>
        ) : (
          <ChatUrlLink key={i} url={tok.value} />
        ),
      )}
    </Typography>
  );
}

/**
 * スタッフチャット (#382)。設計は docs/staff-chat.md。
 *
 * - 公開前（draft）から使える。ゲートはサーバーの staff 判定だけで、
 *   イベントの状態・chatEnabled は見ない
 * - 本文は独自 kind（GROUP_CHAT_KIND）の NIP-44 暗号文としてリレー直通。
 *   復号できないメッセージはそのまま出さない（エラーにもしない）
 * - 発言は**サーバー管理の専用一時鍵のみ**（NIP-07 の選択肢は出さない。
 *   本鍵で書くと運営の相談が全 Nostr 圏の本人と紐付く。設計 3.1）
 * - EventChat.tsx には足さない。共有するのはリレー接続（ChatRelayPool の
 *   kind 引数化）と、上限・時刻書式・URLリンクなどの純粋な部品だけ (#335)
 */
export function StaffChat({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { data: chat, error, isSuccess } = useStaffChat(eventId, true);
  const open = useOpenStaffChat(eventId);

  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [relayConnected, setRelayConnected] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const poolRef = useRef<ChatRelayPool | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 復号結果のキャッシュ。鍵束が増えたら（ローテーション）開け直す
  const decryptedRef = useRef(new Map<string, string | null>());

  /** ポーリング中に staff でなくなった（資格喪失 #382 7.3）。以後は何も出さない */
  const forbidden = error instanceof ApiError && error.status === 403;

  // 部屋・自分の鍵が無ければ作る（先勝ち・冪等。設計 7.1）。
  // 失効から復帰した人（myKey が null で返る）もここで再有効化される。
  // 失敗したらループしない: mutation がエラーのまま止まり、エラー表示に倒す
  // （POST は成功すれば必ず myKey 付きの payload をキャッシュに書くので、
  // 成功し続けてこの条件が立ちっぱなしになることはない）
  useEffect(() => {
    if (!isSuccess || open.isPending || open.isError) return;
    if (chat !== null && chat.myKey !== null) return;
    open.mutate();
    // open（mutation オブジェクト）は毎レンダーで変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, chat, open.isPending, open.isError]);

  // 発言用の署名器（サーバー管理の一時鍵で固定。localStorage には置かない）
  const mySecret = chat?.myKey?.secret ?? null;
  const signer = useMemo<ChatSigner | null>(
    () => (mySecret ? localSignerFromHex(mySecret) : null),
    [mySecret],
  );

  const relays = useMemo(
    () => (chat?.relays?.length ? chat.relays : [...CHAT_RELAYS]),
    [chat],
  );
  const relaysKey = relays.join(" ");
  const roomId = chat?.roomId ?? null;

  // 受信バッファの捨てる順序に使う許可リスト（chatMessageBuffer.ts）。
  // 購読コールバックは effect 内で閉じるので、ポーリングで更新される
  // 最新の集合を ref 経由で見せる
  // 自分の鍵も「捨ててよくない」側に入れる（理由は chatMessageBuffer.ts）
  const keepRef = useRef<(pubkey: string) => boolean>(() => true);
  useEffect(() => {
    keepRef.current = bufferAllowPredicate(
      new Set((chat?.members ?? []).map((m) => m.pubkey)),
      signer?.pubkey,
    );
  }, [chat, signer]);
  const appendToBuffer = (prev: NostrEvent[], ev: NostrEvent) =>
    appendChatMessage(prev, ev, (pk) => keepRef.current(pk));

  // 接続・購読。署名器と部屋が決まったら開始し、unmount で切断
  useEffect(() => {
    if (!signer || !roomId || forbidden) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const pool = new ChatRelayPool(signer, relaysKey.split(" "));
    poolRef.current = pool;
    pool.onstatus = () => {
      if (!disposed) setRelayConnected(pool.connected);
    };
    void (async () => {
      await pool.connect();
      if (disposed) return;
      unsubscribe = pool.subscribe(
        roomId,
        (ev) => {
          if (disposed) return;
          setMessages((prev) => appendToBuffer(prev, ev));
        },
        GROUP_CHAT_KIND,
      );
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      pool.close();
      poolRef.current = null;
      setRelayConnected(false);
      setMessages([]);
    };
  }, [signer, roomId, relaysKey, forbidden]);

  const memberByPubkey = useMemo(
    () =>
      new Map<string, StaffChatMember>(
        (chat?.members ?? []).map((m) => [m.pubkey, m]),
      ),
    [chat],
  );

  // 鍵の世代が変わったら開け直すためのキー（配列参照ではなく値で比較）
  const keys = chat?.keys;
  const keysKey = (keys ?? []).map((k) => k.version).join(",");

  /** 実際に描く分。表示許可リスト外・失効後の発言・復号できないもの・
   * 復号後が上限超のものを除き、末尾 MESSAGE_DISPLAY_MAX 件に丸める */
  const visibleMessages = useMemo(() => {
    if (!keys) return [];
    const cache = decryptedRef.current;
    const kept: Array<{ ev: NostrEvent; member: StaffChatMember; text: string }> =
      [];
    for (const ev of messages) {
      const member = memberByPubkey.get(ev.pubkey);
      if (!member) continue;
      if (!visibleAfterRevocation(member.revokedAt, ev.created_at)) continue;
      const cacheKey = `${ev.id}:${keysKey}`;
      let text = cache.get(cacheKey);
      if (text === undefined) {
        text = openStaffChatMessage(keys, ev);
        cache.set(cacheKey, text);
      }
      if (text === null || text.length > CHAT_MESSAGE_MAX) continue;
      kept.push({ ev, member, text });
    }
    return clampToDisplayMax(kept);
    // keysKey が keys の変化を値で代表する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, memberByPubkey, keysKey]);

  // 新着メッセージで最下部へ自動スクロール
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !signer || !roomId || !keys) return;
    if (text.length > CHAT_MESSAGE_MAX) return;
    setSendError(null);
    try {
      const template = sealStaffChatMessage(roomId, keys, text, relays[0]!);
      if (!template) return;
      const ev = await signer.signEvent(template);
      const ok = await poolRef.current?.publish(ev);
      if (!ok) {
        setSendError(t("eventSocial.chatSendFailedOffline"));
        return;
      }
      setDraft("");
      // リレーからの折返しを待たず即時表示（購読側とはIDで重複排除）
      setMessages((prev) => appendToBuffer(prev, ev));
    } catch {
      setSendError(t("eventSocial.chatSendFailed"));
    }
  };

  // 資格を失った（403）。理由の詳細は書かない（部屋の中身の話をしない）
  if (forbidden) {
    return <Alert severity="info">{t("staffOps.staffChatStaffOnly")}</Alert>;
  }
  if (error) {
    return <Alert severity="error">{t("staffOps.loadFailed")}</Alert>;
  }
  if (open.isError) {
    return <Alert severity="error">{t("staffOps.staffChatOpenFailed")}</Alert>;
  }
  if (!chat || !chat.myKey) {
    return <Typography>{t("common.loading")}</Typography>;
  }

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        {/* 技術用語（Nostr・暗号方式）は出さない。事実だけを短く書く */}
        <Typography variant="caption" color="text.secondary">
          {t("staffOps.staffChatNotice")}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flexShrink: 0, ml: 1 }}
        >
          {relayConnected
            ? t("eventSocial.chatConnected")
            : t("eventSocial.chatOffline")}
        </Typography>
      </Stack>

      <Box ref={listRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
        {visibleMessages.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("eventSocial.chatEmpty")}
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {visibleMessages.map(({ ev, member, text }) => (
              <Stack key={ev.id} direction="row" spacing={1} alignItems="flex-start">
                <Avatar
                  src={member.avatarUrl ?? undefined}
                  component={RouterLink}
                  to={`/users/${member.username}`}
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  {member.name.charAt(0)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="baseline">
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      noWrap
                      component={RouterLink}
                      to={`/users/${member.username}`}
                      sx={{
                        color: "inherit",
                        textDecoration: "none",
                        "&:hover": { textDecoration: "underline" },
                      }}
                    >
                      {member.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatChatTime(ev.created_at)}
                    </Typography>
                  </Stack>
                  <MessageBody text={text} />
                </Box>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      {sendError && (
        <Alert severity="warning" onClose={() => setSendError(null)}>
          {sendError}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          value={draft}
          placeholder={t("eventSocial.chatInputPlaceholder")}
          inputProps={{ maxLength: CHAT_MESSAGE_MAX }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <IconButton
          color="primary"
          disabled={!draft.trim() || !relayConnected}
          onClick={() => void send()}
          aria-label={t("common.send")}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
