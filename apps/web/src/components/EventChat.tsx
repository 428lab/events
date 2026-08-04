import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import SendIcon from "@mui/icons-material/Send";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { Link as RouterLink } from "react-router-dom";
import type { ChatMember, Event, EventRole } from "@eventer/shared";
import {
  CHAT_MESSAGE_MAX,
  CHAT_RELAYS,
  CHAT_WINDOW_AFTER_MS,
  CHAT_WINDOW_BEFORE_MS,
} from "@eventer/shared";
import type { Event as NostrEvent } from "nostr-tools/pure";
import { useMe } from "../api/hooks.js";
import { api, ApiError } from "../api/client.js";
import {
  createOfficialChannelEvent,
  fetchEphemeralChatKey,
  useChatMembers,
  useCreateEphemeralChatKey,
  useHideChatNote,
  useRegisterChatChannel,
  useRegisterChatKey,
  useResetChatChannel,
} from "../api/eventChatHooks.js";
import { hasNip07 } from "../lib/nostr.js";
import {
  ChatRelayPool,
  buildChannelCreateTemplate,
  buildChatKeyProofTemplate,
  buildChannelMessageTemplate,
  localSignerFromHex,
  nip07Signer,
} from "../lib/nostrChat.js";
import type { ChatSigner } from "../lib/nostrChat.js";

/** メッセージ時刻の表示（HH:mm） */
function formatTime(createdAtSec: number): string {
  const d = new Date(createdAtSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Nostrイベントチャット (#199)。NIP-28 パブリックチャットをブラウザから
 * ユーザー所有リレーへ直接読み書きする（サーバーはチャット本文を経由しない）。
 * 表示は許可リスト（chat-members に登録された pubkey）のメッセージのみ。
 */
export function EventChat({
  eventId,
  event,
  myRole,
  canChat,
}: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  /** 参加確定メンバーか（呼び出し側で判定） */
  canChat: boolean;
}) {
  const { data: me } = useMe();
  // イベント配下のUIは myRole のみで判定（サイト管理者でも staff でなければ操作UIを出さない）
  const isStaff = myRole === "staff";
  const dateFixed = !event.scheduling && event.startsAt > 0;
  const visible =
    canChat && event.chatEnabled && dateFixed && event.status === "published";

  const { data: chat } = useChatMembers(eventId, visible);
  const registerKey = useRegisterChatKey(eventId);
  const ephemeralKey = useCreateEphemeralChatKey(eventId);
  const registerChannel = useRegisterChatChannel(eventId);
  const resetChannel = useResetChatChannel(eventId);
  const hideNote = useHideChatNote(eventId);

  const [signer, setSigner] = useState<ChatSigner | null>(null);
  const [keyMode, setKeyMode] = useState<"ephemeral" | "nip07">("ephemeral");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [relayConnected, setRelayConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const poolRef = useRef<ChatRelayPool | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // チャンネル確定処理から最新の chat-members を参照するための ref
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // チャンネル作成時に「主催者×NIP-07」経路かを判定するための ref (#199)
  const meRef = useRef(me);
  meRef.current = me;
  // 現在の signer が NIP-07（Nostrアカウント）か。setSigner の直前に設定する
  const signerIsNip07Ref = useRef(false);

  // 使用するリレー（運用設定。payload 取得前は既定値）
  const relays = useMemo(
    () => (chat?.relays?.length ? chat.relays : [...CHAT_RELAYS]),
    [chat],
  );
  // 内容が同じなら再接続しないための比較キー
  const relaysKey = relays.join(" ");

  // 書き込み可能時間帯（開始30分前〜終了2時間後）。1分ごとに再評価
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const inWriteWindow =
    dateFixed &&
    now >= event.startsAt - CHAT_WINDOW_BEFORE_MS &&
    now <= event.endsAt + CHAT_WINDOW_AFTER_MS;

  // 登録済みの自分の鍵がサーバー管理の一時鍵なら自動で再参加する (#223)
  const myRegisteredPubkey = useMemo(
    () => chat?.members.find((m) => me && m.userId === me.id)?.pubkey ?? null,
    [chat, me],
  );
  useEffect(() => {
    if (signer || !myRegisteredPubkey || !me) return;
    let cancelled = false;
    void (async () => {
      // 自動再参加は任意動作なので、一時的な取得失敗は黙ってスキップする
      const key = await fetchEphemeralChatKey(eventId).catch(() => null);
      if (cancelled || !key) return;
      const local = localSignerFromHex(key.secret);
      if (local.pubkey === myRegisteredPubkey) {
        signerIsNip07Ref.current = false;
        setSigner(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signer, myRegisteredPubkey, eventId, me]);

  // サーバーに登録済みのチャンネルID（未開設は null。5秒ポーリングで反映）
  const serverChannelId = chat?.channelId ?? null;

  // 接続・チャンネル確定・購読。signer が決まったら開始し、unmount で切断
  useEffect(() => {
    if (!signer) return;
    // 部屋の開設はスタッフの操作のみ (#221)。参加者は開設されるまで待つ
    // （serverChannelId が入ると deps 経由でこの effect が再実行される）
    if (!serverChannelId && !isStaff) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const pool = new ChatRelayPool(signer, relaysKey.split(" "));
    poolRef.current = pool;
    pool.onstatus = () => {
      if (!disposed) setRelayConnected(pool.connected);
    };

    (async () => {
      await pool.connect();
      if (disposed) return;

      // チャンネルIDを確定する（未登録ならスタッフが kind:40 を発行して先勝ちで登録）
      let cid = chatRef.current?.channelId ?? serverChannelId;
      if (!cid) {
        try {
          // チャンネル作成鍵の方針 (#199): 参加者個人の鍵では作らない。
          // - 主催者(createdBy)本人が NIP-07 で参加している → 主催者の鍵で署名
          // - それ以外（参加者が最初に開いた等） → 公式サービス鍵（サーバー署名）
          const organizerNip07 =
            signerIsNip07Ref.current &&
            meRef.current?.id === event.createdBy;
          const created: NostrEvent = organizerNip07
            ? await signer.signEvent(buildChannelCreateTemplate(event.title))
            : (await createOfficialChannelEvent(eventId)).channelEvent;
          // リレーに受理されたことを確認してからサーバーへ登録する
          // （不達のまま登録すると「リレー上に存在しない部屋」を参照し続けてしまう）
          //
          // 注意（リレーポリシーのリスク）: 公式鍵署名の kind:40 は「参加者の
          // 接続」から発行する。リレー/プロキシが NIP-42 で
          // 「AUTH済みpubkey == イベントのpubkey」を書き込み条件にしていると
          // 拒否される。その場合は下の joinError が表示されるので、リレー側で
          // 公式鍵のイベントを任意のAUTH済み接続から許可する設定と併せて運用する
          const accepted = await pool.publish(created);
          if (!accepted) {
            if (!disposed) {
              setJoinError(
                "チャンネルの作成に失敗しました（リレーに接続できないか、kind:40 が拒否されました）。",
              );
            }
            return;
          }
          const { channelId: settled } =
            await registerChannel.mutateAsync(created);
          cid = settled ?? created.id;
        } catch (err) {
          if (!disposed) {
            setJoinError(
              err instanceof ApiError && err.status === 503
                ? "公式鍵が未設定のためチャンネルを作成できません（運営に連絡してください）。"
                : "チャンネルの作成に失敗しました。",
            );
          }
          return;
        }
      }
      if (disposed) return;
      setChannelId(cid);
      unsubscribe = pool.subscribe(cid, (ev) => {
        if (disposed) return;
        setMessages((prev) =>
          prev.some((m) => m.id === ev.id)
            ? prev
            : [...prev, ev].sort((a, b) => a.created_at - b.created_at),
        );
      });
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      pool.close();
      poolRef.current = null;
      setRelayConnected(false);
      setMessages([]);
      setChannelId(null);
    };
    // registerChannel（mutation オブジェクト）は毎レンダーで変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, event.title, relaysKey, serverChannelId, isStaff]);

  // 新着メッセージで最下部へ自動スクロール
  const pubkeySet = useMemo(
    () => new Set(chat?.members.map((m) => m.pubkey) ?? []),
    [chat],
  );
  const hiddenSet = useMemo(
    () => new Set(chat?.hiddenNoteIds ?? []),
    [chat],
  );
  const visibleMessages = useMemo(
    () =>
      messages.filter((m) => pubkeySet.has(m.pubkey) && !hiddenSet.has(m.id)),
    [messages, pubkeySet, hiddenSet],
  );
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length]);

  if (!visible) return null;

  // 外部クライアント経由の巨大投稿はUIを壊すので表示対象から除外
  const cappedMessages = visibleMessages.filter(
    (m) => m.content.length <= CHAT_MESSAGE_MAX,
  );
  const memberByPubkey = new Map<string, ChatMember>(
    (chat?.members ?? []).map((m) => [m.pubkey, m]),
  );

  const join = async () => {
    if (!me) return;
    setJoinError(null);
    try {
      const useNip07 = keyMode === "nip07" && hasNip07();
      let s: ChatSigner;
      if (useNip07) {
        s = await nip07Signer();
        // 所有証明: サーバーのchallengeに署名して送る（他人のnpub紐付け防止）
        const { challenge } = await api.get<{ challenge: string }>(
          "/auth/nostr/challenge",
        );
        const proof = await s.signEvent(
          buildChatKeyProofTemplate(challenge, eventId),
        );
        await registerKey.mutateAsync(proof);
      } else {
        // 一時鍵はサーバーが生成・保管して配布する (#223)。発言鍵の登録も
        // サーバー側で行われるため所有証明は不要。複数端末でも同じ鍵になる
        const key = await ephemeralKey.mutateAsync();
        s = localSignerFromHex(key.secret);
      }
      signerIsNip07Ref.current = useNip07;
      setSigner(s);
    } catch (err) {
      // 原因が分かる失敗は出し分ける (#223)
      if (err instanceof ApiError && err.status === 409) {
        setJoinError(
          "この Nostr アカウントの鍵は同じイベントの別のユーザーが使用中です。別のアカウントを選んでください。",
        );
      } else if (err instanceof ApiError && err.status === 403) {
        setJoinError("参加が確定しているメンバーのみチャットを利用できます。");
      } else {
        setJoinError("チャットへの参加に失敗しました。");
      }
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !signer || !channelId || !inWriteWindow) return;
    if (text.length > CHAT_MESSAGE_MAX) return;
    setSendError(null);
    try {
      const ev = await signer.signEvent(
        buildChannelMessageTemplate(channelId, text, relays[0]),
      );
      const ok = await poolRef.current?.publish(ev);
      if (!ok) {
        setSendError("送信に失敗しました（リレーに接続できません）。");
        return;
      }
      setDraft("");
      // リレーからの折返しを待たず即時表示（購読側とはIDで重複排除）
      setMessages((prev) =>
        prev.some((m) => m.id === ev.id)
          ? prev
          : [...prev, ev].sort((a, b) => a.created_at - b.created_at),
      );
    } catch {
      setSendError("送信に失敗しました。");
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 0.5 }}
        >
          <Typography
            variant="h6"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            <ForumOutlinedIcon fontSize="small" />
            チャット
          </Typography>
          {signer && (
            <Typography variant="caption" color="text.secondary">
              {relayConnected ? "接続中" : "オフライン"}
            </Typography>
          )}
        </Stack>

        {/* チャンネル作成の失敗は参加後（signer確定後）にも起きるため、分岐の外で表示する */}
        {joinError && (
          <Alert
            severity="error"
            sx={{ mt: 1 }}
            action={
              isStaff ? (
                <Button
                  size="small"
                  color="inherit"
                  disabled={resetChannel.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "チャンネルを作り直しますか？（リレー上に部屋が無い場合の復旧用。過去のメッセージは新しい部屋には表示されません）",
                      )
                    ) {
                      resetChannel.mutate();
                    }
                  }}
                >
                  チャンネルを作り直す
                </Button>
              ) : undefined
            }
          >
            {joinError}
          </Alert>
        )}
        {chat && !serverChannelId && !isStaff ? (
          // 部屋の開設はスタッフの操作のみ (#221)。それまで参加UIは出さない
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            チャットの部屋はまだ開設されていません。スタッフが開設すると参加できます。
          </Typography>
        ) : !signer ? (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {isStaff && chat && !serverChannelId && (
              <Alert severity="info">
                チャットの部屋はまだありません。参加すると部屋が開設され、参加者もチャットできるようになります。
              </Alert>
            )}
            {hasNip07() && (
              <RadioGroup
                value={keyMode}
                onChange={(e) =>
                  setKeyMode(e.target.value as "ephemeral" | "nip07")
                }
              >
                <FormControlLabel
                  value="ephemeral"
                  control={<Radio size="small" />}
                  label="イベント用の一時鍵で発言"
                />
                <FormControlLabel
                  value="nip07"
                  control={<Radio size="small" />}
                  label="Nostrアカウントで発言"
                />
              </RadioGroup>
            )}
            {keyMode === "nip07" && hasNip07() && (
              <Alert severity="info">
                本アカウントでの発言は events lab の外の Nostr
                クライアントからも見えます。
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              このチャットは Nostr
              のパブリックチャットです（外部クライアントからも閲覧できます）。
            </Typography>
            <Box>
              <Button
                variant="contained"
                size="small"
                disabled={registerKey.isPending || ephemeralKey.isPending || !me}
                onClick={join}
              >
                チャットに参加する
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Box
              ref={listRef}
              sx={{ maxHeight: 360, overflowY: "auto", pr: 0.5 }}
            >
              {visibleMessages.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  まだメッセージはありません。
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {cappedMessages.map((m) => {
                    const member = memberByPubkey.get(m.pubkey);
                    if (!member) return null;
                    return (
                      <Stack
                        key={m.id}
                        direction="row"
                        spacing={1}
                        alignItems="flex-start"
                      >
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
                          <Stack
                            direction="row"
                            spacing={0.75}
                            alignItems="baseline"
                          >
                            <Typography variant="body2" fontWeight={600} noWrap>
                              {member.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {formatTime(m.created_at)}
                            </Typography>
                          </Stack>
                          {/* プレーンテキストのみ（Markdown/HTML は解釈しない） */}
                          <Typography
                            variant="body2"
                            sx={{
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {m.content}
                          </Typography>
                        </Box>
                        {isStaff && (
                          <Tooltip title="このメッセージを非表示にする">
                            <IconButton
                              size="small"
                              disabled={hideNote.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "このメッセージを参加者の画面から非表示にしますか？",
                                  )
                                ) {
                                  hideNote.mutate(m.id);
                                }
                              }}
                            >
                              <VisibilityOffOutlinedIcon
                                sx={{ fontSize: 16 }}
                              />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    );
                  })}
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
                disabled={!inWriteWindow}
                placeholder={
                  inWriteWindow
                    ? "メッセージを入力…"
                    : "書き込みはイベント開催時間の前後のみ"
                }
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
                disabled={!inWriteWindow || !draft.trim() || !channelId}
                onClick={() => void send()}
                aria-label="送信"
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              このチャットは Nostr
              のパブリックチャットです（外部クライアントからも閲覧できます）。
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
