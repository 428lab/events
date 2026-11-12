import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDeckInput,
  Deck,
  DeckSummary,
  Entry,
  ProfileDecksResponse,
  UpdateDeckInput,
} from "@eventer/shared";
import { ApiError, api } from "./client.js";

export function useMyDecks() {
  return useQuery({
    queryKey: ["decks", "mine"],
    queryFn: async () =>
      (await api.get<{ decks: DeckSummary[] }>("/decks/mine")).decks,
  });
}

/** 自分が編集できるチームのスライド（docs/team-participation.md「チームのスライド」） */
export function useMyTeamDecks() {
  return useQuery({
    queryKey: ["decks", "team"],
    queryFn: async () =>
      (await api.get<{ decks: DeckSummary[] }>("/decks/team")).decks,
  });
}

/** そのイベントのチームのスライド。運営は全チームのもの（見るだけ）、参加者は自分のチームのもの */
/** AI に書いてもらっている間のチームのスライド（docs/agent-deck-token.md「チームのスライド」） */
export interface TeamDeckAgent {
  expiresAt: number;
  issuedBy: { name: string } | null;
}
export interface TeamDeckRow {
  entryId: string;
  deck: { id: string; slug: string; title: string; updatedAt: number };
  /** そのチームのいまのメンバーで、イベントが終わっておらず、AI が書いていない */
  canEdit: boolean;
  /** AI に書いてもらっている間（取り消すか期限が切れるまで、メンバーも編集できない） */
  agent?: TeamDeckAgent | null;
}
export function useEventTeamDecks(eventId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["event", eventId, "teamDecks"],
    enabled,
    queryFn: async () =>
      (await api.get<{ decks: TeamDeckRow[] }>(`/events/${eventId}/team-decks`)).decks,
  });
}

/** チームのスライドを作る（すでにあれば既存のものを返す）。応答の最新のエントリー一覧
 * （成果物のプレゼン資料 URL が入る）もキャッシュへ入れる */
export function useCreateTeamDeck(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) =>
      api.post<{ deckId: string; created: boolean; entries: Entry[] }>(`/events/${eventId}/teams/${teamId}/deck`),
    onSuccess: (res) => {
      qc.setQueryData(["event", eventId, "entries"], res.entries);
      qc.invalidateQueries({ queryKey: ["event", eventId, "teamDecks"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "submissions"] });
      qc.invalidateQueries({ queryKey: ["decks", "team"] });
    },
  });
}

/** チームのスライドの AI 用トークンを発行する（まだスライドが無ければ作る）。平文は応答の1回だけ */
export interface IssuedTeamDeckAgentToken {
  token: string;
  specUrl: string;
  deckId: string;
  expiresAt: number;
}
export function useIssueTeamDeckAgentToken(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) =>
      api.post<IssuedTeamDeckAgentToken>(`/events/${eventId}/teams/${teamId}/deck/agent-token`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event", eventId, "teamDecks"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "entries"] });
      qc.invalidateQueries({ queryKey: ["event", eventId, "submissions"] });
    },
  });
}

/** チームのスライドの AI を止める（メンバーなら誰でも）。止めたらまた編集できる */
export function useRevokeTeamDeckAgentToken(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => api.del(`/events/${eventId}/teams/${teamId}/deck/agent-token`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["event", eventId, "teamDecks"] }),
  });
}

/** 編集用（個人のデッキは持ち主、チームのスライドはそのチームのいまのメンバー） */
export function useDeck(id: string) {
  return useQuery({
    queryKey: ["deck", id],
    enabled: Boolean(id),
    queryFn: () => api.get<Deck>(`/decks/${id}`),
    // AI がチームのスライドを書いている間（423）は、取り直しても同じなのですぐ案内を出す
    retry: (count, error) => !(error instanceof ApiError && error.status === 423) && count < 3,
  });
}

/** 公開閲覧 */
export function usePublicDeck(slug: string) {
  return useQuery({
    queryKey: ["publicDeck", slug],
    enabled: Boolean(slug),
    queryFn: () => api.get<Deck>(`/public/decks/${slug}`),
  });
}

export function useCreateDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeckInput) => api.post<Deck>("/decks", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decks", "mine"] }),
  });
}

export function useUpdateDeck(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDeckInput) =>
      api.patch<Deck>(`/decks/${id}`, input),
    // 保存できた版を編集画面へ返す（次の保存の baseRevision）。["deck", id] は取り直さない:
    // 取り直すと、保存中に打った文字を古い応答で上書きしかねない（編集画面は読み込み時だけ使う）
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decks", "mine"] });
      qc.invalidateQueries({ queryKey: ["decks", "team"] });
    },
  });
}

export function useUploadDeckImage(deckId: string) {
  return useMutation({
    mutationFn: async (file: Blob): Promise<{ url: string }> => {
      const res = await fetch(`/api/decks/${deckId}/images`, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        credentials: "include",
        body: file,
      });
      if (!res.ok) throw new Error("upload_failed");
      return res.json();
    },
  });
}

export function useDeleteDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/decks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decks", "mine"] }),
  });
}

/** AI エージェント用の一時トークン（docs/agent-deck-token.md） */
export interface DeckAgentToken {
  id: string;
  createdAt: number;
  expiresAt: number;
  writeCount: number;
  imageCount: number;
  deck: { id: string; slug: string; title: string; editUrl: string; viewUrl: string } | null;
}
/** 発行の応答。平文のトークンはこの1回だけ返る */
export interface IssuedDeckAgentToken extends DeckAgentToken {
  token: string;
  specUrl: string;
}

/** 有効なトークンの一覧。定期取得はしない (D-POLL-MIN)。AI の作業から画面へ戻ったとき
 * （フォーカス）と「最新にする」で取り直す */
export function useDeckAgentTokens(enabled: boolean) {
  return useQuery({
    queryKey: ["deckAgentTokens"],
    enabled,
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<{ tokens: DeckAgentToken[] }>("/decks/agent-tokens")).tokens,
  });
}

export function useIssueDeckAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IssuedDeckAgentToken>("/decks/agent-tokens"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deckAgentTokens"] }),
  });
}

export function useRevokeDeckAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/decks/agent-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deckAgentTokens"] }),
  });
}

/** プロフィールの「スライド」タブ（docs/profile-tabs.md「スライド」）。本人が載せたデッキだけ */
export function useProfileDecks(handle: string, enabled = true) {
  return useQuery({
    queryKey: ["profileDecks", handle],
    enabled: Boolean(handle) && enabled,
    queryFn: () => api.get<ProfileDecksResponse>(`/public/users/${encodeURIComponent(handle)}/decks`),
  });
}

/** このデッキを自分のプロフィールに載せる／載せない。一覧とプロフィールを取り直す */
export function useSetDeckProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deckId, show }: { deckId: string; show: boolean }) =>
      api.put(`/decks/${deckId}/profile`, { show }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["decks"] });
      void qc.invalidateQueries({ queryKey: ["profileDecks"] });
    },
  });
}

/** 「スライドをすべて自動で載せる」 */
export function useSetProfileDeckAuto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoShow: boolean) => api.put("/decks/profile-auto", { autoShow }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["decks"] });
      void qc.invalidateQueries({ queryKey: ["profileDecks"] });
    },
  });
}

/** 公開ビューアを開いたら表示回数を1回数え、今の回数を返す（同じ訪問者は1日1回。持ち主・メンバーは数えない） */
export function useDeckViewCount(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["deckViews", slug],
    enabled: Boolean(slug) && enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => (await api.post<{ views: number }>(`/public/decks/${slug}/view`, {})).views,
  });
}
