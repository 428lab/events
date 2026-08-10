import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import GavelIcon from "@mui/icons-material/Gavel";
import {
  MODERATION_EVENT_LIMIT,
  MODERATION_KINDS,
  MODERATION_KIND_LABELS,
} from "@eventer/shared";
import type {
  ModerationChat,
  ModerationItem,
  ModerationKind,
} from "@eventer/shared";
import { useIsAdmin } from "../api/hooks.js";
import {
  useBlockChatAuthor,
  useModerateContent,
  useModerationContent,
  useModerationEvents,
} from "../api/moderationHooks.js";
import { InfoTip } from "../components/InfoTip.js";
import { ChatRelayPool, randomLocalSigner } from "../lib/nostrChat.js";
import type { ChatSigner } from "../lib/nostrChat.js";
import { formatDateTime } from "../lib/format.js";

/** リレーから届く1件（購読して受け取る形のまま扱う） */
interface RelayNote {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
}

/** 対処の状態バッジ。運営の非表示とスタッフの非表示は別系統なので分けて出す。
 *
 * 運営が対処していても、その **前からスタッフが非表示にしていた** ことは分かるように
 * 出す。復元してもスタッフの非表示までは解けない（そこまでは戻さない）ため、
 * 「復元したのにまだ見えない」を運営が事前に分かる必要がある。 */
function StateChip({
  adminHidden,
  staffHidden,
}: {
  adminHidden: boolean;
  staffHidden: boolean;
}) {
  if (adminHidden) {
    return (
      <Chip
        size="small"
        color="error"
        label={
          staffHidden ? "運営が非表示（スタッフも非表示）" : "運営が非表示"
        }
      />
    );
  }
  if (staffHidden) {
    return (
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        label="スタッフが非表示"
      />
    );
  }
  return <Chip size="small" variant="outlined" label="表示中" />;
}

function authorText(item: ModerationItem): string {
  if (item.authorName) return `${item.authorName}（@${item.authorHandle}）`;
  return item.authorUserId ?? "（不明）";
}

/** 1件の行。写真は本文が無いので画像そのものを出す */
function ItemRow({
  eventId,
  item,
  onAct,
  pending,
}: {
  eventId: string;
  item: ModerationItem;
  onAct: (action: "hide" | "restore", item: ModerationItem) => void;
  pending: boolean;
}) {
  const hidden = item.hiddenAt !== null;
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      sx={{ py: 1.25, borderTop: 1, borderColor: "divider" }}
    >
      {item.kind === "photo" && (
        <Box
          component="img"
          // 管理画面は非表示にした写真も見られる（復元してよいか判断するため）
          src={`/api/admin/moderation/events/${eventId}/photos/${item.id}/image`}
          alt=""
          sx={{
            width: 96,
            height: 96,
            objectFit: "cover",
            borderRadius: 1,
            flexShrink: 0,
            // 対処済みは見た目でも分かるようにする
            opacity: hidden ? 0.5 : 1,
          }}
        />
      )}
      <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <StateChip adminHidden={hidden} staffHidden={item.staffHidden} />
          <Typography variant="caption" color="text.secondary">
            {authorText(item)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(item.createdAt)}
          </Typography>
        </Stack>
        {item.body && (
          <Typography
            variant="body2"
            sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {item.body}
          </Typography>
        )}
        {hidden && (
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(item.hiddenAt as number)} に非表示
            {item.staffHidden &&
              "（復元しても、スタッフの非表示はそのまま残ります）"}
          </Typography>
        )}
      </Stack>
      <Button
        size="small"
        variant={hidden ? "outlined" : "contained"}
        color={hidden ? "inherit" : "error"}
        disabled={pending}
        onClick={() => onAct(hidden ? "restore" : "hide", item)}
        sx={{ flexShrink: 0 }}
      >
        {hidden ? "復元する" : "非表示にする"}
      </Button>
    </Stack>
  );
}

/** 締め出している発言者の一覧 (#283)。
 *
 * 誤操作は必ず起きるので、**誰を締め出しているかが一覧でき、ここから解除できる**
 * ことを機能の一部として扱う。リレーからメッセージが取れていなくても出す
 * （解除の導線がメッセージの取得に依存すると、取れないときに解除できなくなる）。
 *
 * 並べるのは**人ごとに1行** (#332)。chat.blocked はその人の鍵ぜんぶを返す
 * （どの発言に「締め出し中」の印を付けるかは鍵で決まるため）ので、そのまま
 * 並べると同じ名前が鍵の数だけ並び、件数も人数ではなく鍵の数になる。
 * 解除はどの鍵を指してもその人ぶんがまとめて解けるので、代表の1本を渡せばよい。 */
function BlockedAuthorList({
  chat,
  nameOf,
  onUnblock,
  pending,
}: {
  chat: ModerationChat;
  nameOf: (pubkey: string) => string;
  onUnblock: (pubkey: string) => void;
  pending: boolean;
}) {
  // 持ち主を辿れない鍵 (userId === null) は、まとめようがないので鍵ごとに残す。
  // chat.blocked は締め出した順なので、残るのは各人の最初の1本
  const authors = useMemo(() => {
    const seen = new Set<string>();
    return chat.blocked.filter((b) => {
      if (b.userId == null) return true;
      if (seen.has(b.userId)) return false;
      seen.add(b.userId);
      return true;
    });
  }, [chat.blocked]);
  if (authors.length === 0) return null;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>
            締め出している発言者（{authors.length} 人）
          </Typography>
          {authors.map((b) => (
            <Stack
              key={b.pubkey}
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ py: 0.75, borderTop: 1, borderColor: "divider" }}
            >
              <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{nameOf(b.pubkey)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(b.blockedAt)} に締め出し
                </Typography>
              </Stack>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                disabled={pending}
                onClick={() => onUnblock(b.pubkey)}
                sx={{ flexShrink: 0 }}
              >
                解除する
              </Button>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** チャットは本文がこのサービスの外にあり、ブラウザが直接読みに行く。
 * ここでできるのはこのサービスの表示から消すことだけ。 */
function ChatSection({
  chat,
  onAct,
  onBlock,
  pending,
}: {
  chat: ModerationChat;
  onAct: (action: "hide" | "restore", noteId: string) => void;
  /** 発言者単位の締め出し / 解除 (#283) */
  onBlock: (action: "block" | "unblock", pubkey: string) => void;
  pending: boolean;
}) {
  const [notes, setNotes] = useState<RelayNote[]>([]);
  const [connected, setConnected] = useState(false);
  const signerRef = useRef<ChatSigner | null>(null);
  if (!signerRef.current) {
    // 読むだけなので使い捨ての鍵。リレーの認証に応えるためだけに使い、発言はしない
    signerRef.current = randomLocalSigner();
  }
  const relaysKey = chat.relays.join(" ");
  const channelId = chat.channelId;

  useEffect(() => {
    const signer = signerRef.current;
    if (!channelId || !signer) return;
    let disposed = false;
    const pool = new ChatRelayPool(signer, relaysKey.split(" "));
    pool.onstatus = () => {
      if (!disposed) setConnected(pool.connected);
    };
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      await pool.connect();
      if (disposed) return;
      unsubscribe = pool.subscribe(channelId, (ev) => {
        if (disposed) return;
        setNotes((prev) =>
          prev.some((n) => n.id === ev.id)
            ? prev
            : [...prev, ev as RelayNote].sort(
                (a, b) => b.created_at - a.created_at,
              ),
        );
      });
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
      pool.close();
      setConnected(false);
      setNotes([]);
    };
  }, [channelId, relaysKey]);

  const nameOf = useMemo(() => {
    const byPubkey = new Map(chat.members.map((m) => [m.pubkey, m]));
    return (pubkey: string) => {
      const m = byPubkey.get(pubkey);
      return m ? `${m.name}（@${m.username}）` : `${pubkey.slice(0, 12)}…`;
    };
  }, [chat.members]);

  const hiddenById = useMemo(
    () => new Map(chat.hidden.map((h) => [h.noteId, h])),
    [chat.hidden],
  );
  const blockedSet = useMemo(
    () => new Set(chat.blocked.map((b) => b.pubkey)),
    [chat.blocked],
  );
  // リレーから取れなかった（消えた・まだ届いていない）非表示ぶんも一覧に残す
  const orphanHidden = chat.hidden.filter(
    (h) => !notes.some((n) => n.id === h.noteId),
  );

  return (
    <Stack spacing={1}>
      <Alert severity="warning">
        チャットのメッセージは、このサービスの外にも公開されています。ここで非表示にしても
        <strong>このサービスの表示から消えるだけ</strong>
        で、外部に出たものは消せません。
      </Alert>
      <Alert severity="info">
        1人が大量に投稿している場合は、
        <strong>発言者ごと締め出す</strong>
        こともできます。締め出しは
        <strong>発言者（アカウント）ごと</strong>
        に効くので、その人がこのイベントで使ったすべての発言が
        <strong>このサービスの表示からまとめて消え</strong>、
        その人はこのサービスからは投稿できなくなります。
        入り直しても、同じアカウントである限り締め出されたままです。
        発言そのものは消えないので、解除すれば元に戻ります。
        締め出された側に理由は表示されません。
        なお、このサービスの外から投稿すること自体は止められません（その投稿もこのサービスには表示されません）。
        別のアカウントで入り直すことも防げません。その場の投稿を止めるための機能です。
      </Alert>
      <BlockedAuthorList
        chat={chat}
        nameOf={nameOf}
        pending={pending}
        onUnblock={(pubkey) => onBlock("unblock", pubkey)}
      />
      {!channelId ? (
        <Typography variant="body2" color="text.secondary">
          このイベントではチャットが使われていません。
        </Typography>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary">
            {connected
              ? `メッセージを読み込んでいます（${notes.length} 件）`
              : "接続中…"}
          </Typography>
          {notes.map((n) => {
            const h = hiddenById.get(n.id);
            return (
              <Stack
                key={n.id}
                direction="row"
                spacing={1.5}
                alignItems="flex-start"
                sx={{ py: 1.25, borderTop: 1, borderColor: "divider" }}
              >
                <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <StateChip
                      adminHidden={h?.hiddenAt != null}
                      staffHidden={Boolean(h?.staffHidden)}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {nameOf(n.pubkey)}
                    </Typography>
                    {blockedSet.has(n.pubkey) && (
                      <Chip size="small" color="error" label="締め出し中" />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(n.created_at * 1000)}
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {n.content}
                  </Typography>
                </Stack>
                <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    variant={h?.hiddenAt ? "outlined" : "contained"}
                    color={h?.hiddenAt ? "inherit" : "error"}
                    disabled={pending}
                    onClick={() => onAct(h?.hiddenAt ? "restore" : "hide", n.id)}
                  >
                    {h?.hiddenAt ? "復元する" : "非表示にする"}
                  </Button>
                  {blockedSet.has(n.pubkey) ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="inherit"
                      disabled={pending}
                      onClick={() => onBlock("unblock", n.pubkey)}
                    >
                      締め出しを解除
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "この発言者のこのイベントでの発言をすべて非表示にし、このサービスからは投稿できないようにしますか？（この画面から解除できます）",
                          )
                        ) {
                          onBlock("block", n.pubkey);
                        }
                      }}
                    >
                      この発言者を締め出す
                    </Button>
                  )}
                </Stack>
              </Stack>
            );
          })}
          {orphanHidden.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              リレーから取得できなかった非表示ぶんが {orphanHidden.length}{" "}
              件あります（本文は表示できません）。
            </Typography>
          )}
        </>
      )}
    </Stack>
  );
}

/** 管理者向け: イベント内コンテンツの非表示・復元 (#278)。
 *
 * イベントのスタッフによる削除とは **別系統**。ここで非表示にしたものは、
 * そのイベントのスタッフから見ても通常の画面に出なくなり、この画面からしか戻せない。 */
export function AdminModerationPage() {
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const userId = params.get("userId") ?? "";
  const [term, setTerm] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const eventId = params.get("eventId") ?? "";

  const { data: found } = useModerationEvents(isAdmin, { userId, q: query });
  const { data, isLoading } = useModerationContent(eventId, isAdmin);
  const act = useModerateContent(eventId);
  const blockAuthor = useBlockChatAuthor(eventId);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const byKind = useMemo(() => {
    const map = new Map<ModerationKind, ModerationItem[]>();
    for (const item of data?.items ?? []) {
      const list = map.get(item.kind) ?? [];
      list.push(item);
      map.set(item.kind, list);
    }
    return map;
  }, [data]);

  if (!isAdmin) {
    return <Alert severity="warning">この画面は運営管理者専用です。</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
      >
        <GavelIcon fontSize="medium" />
        コンテンツの対処
      </Typography>
      <Alert severity="info">
        イベント内のコンテンツを<strong>非表示</strong>
        にします（削除ではないので、この画面から復元できます）。
        非表示にしたものは、そのイベントのスタッフから見ても通常の画面には出ません。
        スタッフ自身の削除操作はこれまでどおりで、こことは別系統です。
      </Alert>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={0.25} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                対処するイベントを選ぶ
              </Typography>
              <InfoTip
                label="イベントの探し方"
                text="イベント名の一部、またはイベントIDで探せます。要確認リストの「コンテンツを確認」から来た場合は、その人が主催・投稿したイベントが並びます。"
                size={16}
              />
            </Stack>
            {userId && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  size="small"
                  label={`対象ユーザーで絞り込み中: ${userId.slice(0, 8)}…`}
                  onDelete={() => setParam("userId", "")}
                />
              </Stack>
            )}
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="イベント名 / イベントID"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setQuery(term);
                    setParam("q", term);
                  }
                }}
              />
              <Button
                variant="outlined"
                onClick={() => {
                  setQuery(term);
                  setParam("q", term);
                }}
              >
                探す
              </Button>
            </Stack>
            {found && found.events.length === 0 && (query || userId) && (
              <Typography variant="body2" color="text.secondary">
                該当するイベントはありません。
              </Typography>
            )}
            {found?.truncated && (
              // 打ち切ったことは必ず出す。黙って候補を隠すと「対象なし」に見えてしまう
              <Alert severity="warning">
                新しい順に {MODERATION_EVENT_LIMIT}{" "}
                件まで表示しています。ここに無いイベントは、
                イベント名かイベントIDで検索してください。
              </Alert>
            )}
            <Stack spacing={0.5}>
              {found?.events.map((e) => (
                <Button
                  key={e.id}
                  size="small"
                  variant={e.id === eventId ? "contained" : "text"}
                  onClick={() => setParam("eventId", e.id)}
                  sx={{ justifyContent: "flex-start", textAlign: "left" }}
                >
                  {e.title}
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    {formatDateTime(e.startsAt)}
                    {e.hostHandle ? ` / @${e.hostHandle}` : ""}
                  </Typography>
                </Button>
              ))}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {eventId && (isLoading || !data) && <Typography>読み込み中…</Typography>}

      {eventId && data && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle1" fontWeight={700}>
                {data.event.title}
              </Typography>
              {MODERATION_KINDS.map((kind) => {
                const items = byKind.get(kind) ?? [];
                return (
                  <Stack key={kind} spacing={0.5}>
                    <Divider />
                    <Typography variant="subtitle2" fontWeight={700}>
                      {MODERATION_KIND_LABELS[kind]}
                      {kind !== "chat_message" && `（${items.length} 件）`}
                    </Typography>
                    {kind === "chat_message" ? (
                      <ChatSection
                        chat={data.chat}
                        pending={act.isPending || blockAuthor.isPending}
                        onAct={(action, noteId) =>
                          act.mutate({ action, kind, id: noteId })
                        }
                        onBlock={(action, pubkey) =>
                          blockAuthor.mutate({ action, pubkey })
                        }
                      />
                    ) : items.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        ありません。
                      </Typography>
                    ) : (
                      items.map((item) => (
                        <ItemRow
                          key={`${item.kind}:${item.id}`}
                          eventId={eventId}
                          item={item}
                          pending={act.isPending}
                          onAct={(action, target) =>
                            act.mutate({
                              action,
                              kind: target.kind,
                              id: target.id,
                            })
                          }
                        />
                      ))
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
