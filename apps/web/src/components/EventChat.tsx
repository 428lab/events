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
  Link,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ConstructionOutlinedIcon from "@mui/icons-material/ConstructionOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import OpenInFullOutlinedIcon from "@mui/icons-material/OpenInFullOutlined";
import SendIcon from "@mui/icons-material/Send";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { Link as RouterLink } from "react-router-dom";
import type { ChatMember, Event, EventRole } from "@eventer/shared";
import {
  CHAT_MESSAGE_MAX,
  containsUrl,
  detectImageUrl,
  splitByUrls,
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
  randomLocalSigner,
} from "../lib/nostrChat.js";
import type { ChatSigner } from "../lib/nostrChat.js";
import { ImageLightbox } from "./ImageLightbox.js";

/** 状態に貯めておくメッセージの上限 (#215)。投影用画面は何時間もつけっぱなしに
 * するので、際限なく増やすと配列とDOMがそのまま伸びる。表示対象を選ぶ前の
 * 生の受信ぶんなので、表示上限より少し多めに持つ */
const MESSAGE_BUFFER_MAX = 500;
/** 実際に描画する件数の上限 (#215)。古い方から捨てて末尾だけを出す */
const MESSAGE_DISPLAY_MAX = 200;

/** チャットに繋がらないときの文言 (#283)。
 * 理由は書かないが、嘘も書かない（事実として「繋がっていない」だけを伝える）。
 * 締め出された側からは通信の不調と区別が付かないので、これで目的は足りる */
const CHAT_UNAVAILABLE_TEXT = "このイベントのチャットに接続できません。";

/** 「チャットに繋がせない状態」(#283) のサーバー応答か。
 * 許可リストの取得 (chat-members) と参加ボタン (chat-key) の両方が同じ 403 を返すので、
 * 判定はここ1箇所に寄せる。**status も見る**: 別のエンドポイントが同じ
 * error 名を別のステータスで返し始めたときに、無関係な失敗をこの画面に
 * 吸い込ませないため */
function isChatUnavailable(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 403 &&
    (err.body as { error?: string } | null)?.error === "chat_unavailable"
  );
}

/** 受信・送信したメッセージを時刻順に足す。IDで重複排除し、古い方から丸める */
function appendMessage(prev: NostrEvent[], ev: NostrEvent): NostrEvent[] {
  if (prev.some((m) => m.id === ev.id)) return prev;
  const next = [...prev, ev].sort((a, b) => a.created_at - b.created_at);
  return next.length > MESSAGE_BUFFER_MAX
    ? next.slice(next.length - MESSAGE_BUFFER_MAX)
    : next;
}

/** メッセージ時刻の表示（HH:mm:ss） */
function formatTime(createdAtSec: number): string {
  const d = new Date(createdAtSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 本文中のURLリンク（新しいタブで開く） */
function ChatUrlLink({ url }: { url: string }) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ wordBreak: "break-all" }}
    >
      {url}
    </Link>
  );
}

/** インライン画像。読み込み失敗時はリンク表示にフォールバック (#241) */
function InlineChatImage({
  url,
  onOpen,
}: {
  url: string;
  onOpen: (url: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ChatUrlLink url={url} />;
  return (
    <Box
      component="img"
      src={url}
      alt={url}
      loading="lazy"
      draggable={false}
      // 外部ホストにチャットのURLを渡さない（既存の画像表示と同ポリシー）
      referrerPolicy="no-referrer"
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter") onOpen(url);
      }}
      onClick={() => onOpen(url)}
      onError={() => setFailed(true)}
      sx={{
        maxWidth: "100%",
        maxHeight: 220,
        objectFit: "contain",
        display: "block",
        mt: 0.5,
        borderRadius: "4px",
        cursor: "zoom-in",
      }}
    />
  );
}

/** メッセージ本文。linkify のときだけURLをリンク/インライン画像にする (#241)。
 * 表示側で制御するのは、外部クライアントからの投稿はサーバーで
 * 止められないため（プレーン表示が最終防衛線） */
function MessageBody({
  content,
  linkify,
  onOpenImage,
  fontSize,
}: {
  content: string;
  linkify: boolean;
  onOpenImage: (url: string) => void;
  /** 投影用の拡大表示 (#215)。未指定なら variant="body2" の既定サイズ */
  fontSize?: string;
}) {
  return (
    <Typography
      variant="body2"
      sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize }}
    >
      {linkify
        ? splitByUrls(content).map((tok, i) =>
            tok.type === "text" ? (
              <span key={i}>{tok.value}</span>
            ) : detectImageUrl(tok.value) ? (
              <InlineChatImage key={i} url={tok.value} onOpen={onOpenImage} />
            ) : (
              <ChatUrlLink key={i} url={tok.value} />
            ),
          )
        : content}
    </Typography>
  );
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
  variant = "card",
  fontScale = 1,
}: {
  eventId: string;
  event: Event;
  myRole: EventRole | null;
  /** 参加確定メンバーか（呼び出し側で判定） */
  canChat: boolean;
  /** card=イベントページ内のカード / page=専用ページで縦いっぱい /
   * display=投影用（見出し・入力欄・操作UIなしで本文だけを流す） (#215) */
  variant?: "card" | "page" | "display";
  /** display のときの文字サイズ倍率（投影距離に合わせて呼び出し側が変える） */
  fontScale?: number;
}) {
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
  const dateFixed = !event.scheduling && event.startsAt > 0;
  const visible =
    canChat && event.chatEnabled && dateFixed && event.status === "published";

  const { data: chat, error: chatError } = useChatMembers(eventId, visible);
  /** チャットに繋がせない状態か (#283)。
   *
   * **理由は画面に書かない**。「あなたは締め出されました」と伝えると、
   * 別の鍵を作って戻ってくるだけで意味がないため。
   * ただし「ネットワークが不調です」のような嘘も書かない。誤って締め出された人が
   * 回線を疑って時間を無駄にするし、後で分かったときに嘘をついたことになる。
   * 理由を明かさず、事実として正しい文言（上の CHAT_UNAVAILABLE_TEXT）だけを出す。 */
  const chatUnavailable = isChatUnavailable(chatError);
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
  // タップで拡大表示中のインライン画像URL (#241)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
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
    // 投影用は参加操作をしない（下の読み取り専用の鍵で購読するだけ）
    if (display || signer || !myRegisteredPubkey || !me) return;
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
  }, [display, signer, myRegisteredPubkey, eventId, me]);

  // 投影用画面は「読むだけ」なので、参加していなくても本文が出るようにする (#215)。
  // NIP-07 で参加している人が開くと一時鍵は取れず signer が決まらないため、
  // signer 頼みにするとメッセージが1件も出ない。リレーの NIP-42 AUTH に
  // 応答するためだけの使い捨て鍵で購読する（この鍵では発言しない）
  const readOnlySignerRef = useRef<ChatSigner | null>(null);
  if (display && !readOnlySignerRef.current) {
    readOnlySignerRef.current = randomLocalSigner();
  }
  const activeSigner = signer ?? (display ? readOnlySignerRef.current : null);

  // サーバーに登録済みのチャンネルID（未開設は null。5秒ポーリングで反映）
  const serverChannelId = chat?.channelId ?? null;
  // 部屋の開設はスタッフの操作 (#221)。投影用は見せるだけなので開設もしない
  const canOpenChannel = isStaff && !display;

  // 接続・チャンネル確定・購読。署名器が決まったら開始し、unmount で切断
  useEffect(() => {
    if (!activeSigner) return;
    // 繋がせない状態 (#283) ではリレーにも接続しない。
    // 署名器が手元に残っていても、購読も送信も始めない
    if (chatUnavailable) return;
    // 部屋が未開設なら、開設できる人以外は待つ
    // （serverChannelId が入ると deps 経由でこの effect が再実行される）
    if (!serverChannelId && !canOpenChannel) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const pool = new ChatRelayPool(activeSigner, relaysKey.split(" "));
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
            ? await activeSigner.signEvent(
                buildChannelCreateTemplate(event.title),
              )
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
        setMessages((prev) => appendMessage(prev, ev));
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
  }, [
    activeSigner,
    event.title,
    relaysKey,
    serverChannelId,
    canOpenChannel,
    chatUnavailable,
  ]);

  // 新着メッセージで最下部へ自動スクロール
  const pubkeySet = useMemo(
    () => new Set(chat?.members.map((m) => m.pubkey) ?? []),
    [chat],
  );
  const hiddenSet = useMemo(
    () => new Set(chat?.hiddenNoteIds ?? []),
    [chat],
  );
  /** 実際に描く分。許可リスト外・非表示・外部クライアント経由の巨大投稿
   * （UIを壊す）を除いたうえで、末尾 MESSAGE_DISPLAY_MAX 件に丸める (#215) */
  const visibleMessages = useMemo(() => {
    const kept = messages.filter(
      (m) =>
        pubkeySet.has(m.pubkey) &&
        !hiddenSet.has(m.id) &&
        m.content.length <= CHAT_MESSAGE_MAX,
    );
    return kept.length > MESSAGE_DISPLAY_MAX
      ? kept.slice(kept.length - MESSAGE_DISPLAY_MAX)
      : kept;
  }, [messages, pubkeySet, hiddenSet]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length]);

  if (!visible) return null;

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
      } else if (isChatUnavailable(err)) {
        // 締め出し (#283)。締め出された人は**参加が確定している**ので、
        // 下の「参加が確定しているメンバーのみ」に落とすと事実と違う説明になる。
        // 理由は書かないが嘘も書かない、で上の表示と同じ文言に揃える
        setJoinError(CHAT_UNAVAILABLE_TEXT);
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
    // URL投稿の送信ガード (#241)。判定は表示側のリンク化と同じ関数を共用
    if (!isStaff && !event.chatUrlsAllowed && containsUrl(text)) {
      setSendError("URLの投稿はこのイベントでは許可されていません。");
      return;
    }
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
      setMessages((prev) => appendMessage(prev, ev));
    } catch {
      setSendError("送信に失敗しました。");
    }
  };

  // 投影用のサイズ（プロジェクターやウィンドウキャプチャで読める大きさ）
  const bodyFontSize = display ? `${1.5 * fontScale}rem` : undefined;
  const nameFontSize = display ? `${1 * fontScale}rem` : undefined;
  const avatarSize = display ? Math.round(44 * fontScale) : 28;

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
          チャット
        </Typography>
      )}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: bodyFontSize }}
      >
        {CHAT_UNAVAILABLE_TEXT}
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
            チャット
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {signer && (
              <Typography variant="caption" color="text.secondary">
                {relayConnected ? "接続中" : "オフライン"}
              </Typography>
            )}
            {variant === "card" && (
              <Tooltip title="チャット画面で開く">
                <IconButton
                  size="small"
                  component={RouterLink}
                  to={`/events/${eventId}/chat`}
                  aria-label="チャット画面で開く"
                >
                  <OpenInFullOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        {/* チャンネル作成の失敗は参加後（signer確定後）にも起きるため、分岐の外で表示する。
            投影用には出さない（リレーやkindの話を会場のスクリーンに映さない） */}
        {joinError && !display && (
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
        {/* 投影用はどちらの分岐にも入らず、常にメッセージ一覧だけを出す (#215)。
            参加操作は戻り先の通常のチャット画面に任せる */}
        {!display && chat && !serverChannelId && !isStaff ? (
          // 部屋の開設はスタッフの操作のみ (#221)。それまで参加UIは出さない
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            チャットの部屋はまだ開設されていません。スタッフが開設すると参加できます。
          </Typography>
        ) : !display && !signer ? (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {showStaffActions && chat && !serverChannelId && (
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
              チャットの内容は公開されます。
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
          <Stack
            spacing={1.5}
            sx={{
              mt: 1,
              ...(fullHeight ? { flex: 1, minHeight: 0 } : {}),
            }}
          >
            <Box
              ref={listRef}
              sx={{
                ...(fullHeight ? { flex: 1, minHeight: 0 } : { maxHeight: 360 }),
                overflowY: "auto",
                pr: 0.5,
              }}
            >
              {visibleMessages.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontSize: bodyFontSize }}
                >
                  {display
                    ? "まだ表示できるメッセージがありません。"
                    : "まだメッセージはありません。"}
                </Typography>
              ) : (
                <Stack spacing={display ? 2 : 1.25}>
                  {visibleMessages.map((m) => {
                    const member = memberByPubkey.get(m.pubkey);
                    if (!member) return null;
                    return (
                      <Stack
                        key={m.id}
                        direction="row"
                        spacing={display ? 1.5 : 1}
                        alignItems="flex-start"
                      >
                        <Avatar
                          src={member.avatarUrl ?? undefined}
                          component={RouterLink}
                          to={`/users/${member.username}`}
                          sx={{
                            width: avatarSize,
                            height: avatarSize,
                            fontSize: display ? avatarSize * 0.45 : 13,
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
                            <Typography
                              variant="body2"
                              fontWeight={600}
                              noWrap
                              component={RouterLink}
                              to={`/users/${member.username}`}
                              sx={{
                                // スタッフの発言は色分け (#228)
                                color:
                                  member.role === "staff"
                                    ? "secondary.main"
                                    : "inherit",
                                textDecoration: "none",
                                "&:hover": { textDecoration: "underline" },
                                fontSize: nameFontSize,
                              }}
                            >
                              {member.name}
                            </Typography>
                            {member.role === "staff" && (
                              <Tooltip title="スタッフ">
                                <ConstructionOutlinedIcon
                                  sx={{
                                    fontSize: display ? 20 * fontScale : 14,
                                    color: "secondary.main",
                                    alignSelf: "center",
                                  }}
                                />
                              </Tooltip>
                            )}
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontSize: display ? nameFontSize : undefined }}
                            >
                              {formatTime(m.created_at)}
                            </Typography>
                          </Stack>
                          {/* Markdown/HTML は解釈しない。URLのリンク化・画像化は
                              スタッフの発言か、URL投稿が許可されたイベントのみ (#241) */}
                          <MessageBody
                            content={m.content}
                            linkify={
                              member.role === "staff" || event.chatUrlsAllowed
                            }
                            onOpenImage={setLightboxUrl}
                            fontSize={bodyFontSize}
                          />
                        </Box>
                        {showStaffActions && (
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

            {sendError && !display && (
              <Alert severity="warning" onClose={() => setSendError(null)}>
                {sendError}
              </Alert>
            )}
            {/* 投影用は入力欄を出さない（読むだけの画面） (#215) */}
            {!display && (
              <>
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
              チャットの内容は公開されます。
            </Typography>
              </>
            )}
          </Stack>
        )}
        <ImageLightbox
          src={lightboxUrl ?? ""}
          open={lightboxUrl !== null}
          onClose={() => setLightboxUrl(null)}
        />
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
