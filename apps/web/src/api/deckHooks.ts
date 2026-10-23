import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDeckInput,
  Deck,
  DeckSummary,
  UpdateDeckInput,
} from "@eventer/shared";
import { api } from "./client.js";

export function useMyDecks() {
  return useQuery({
    queryKey: ["decks", "mine"],
    queryFn: async () =>
      (await api.get<{ decks: DeckSummary[] }>("/decks/mine")).decks,
  });
}

/** 編集用（owner本人） */
export function useDeck(id: string) {
  return useQuery({
    queryKey: ["deck", id],
    enabled: Boolean(id),
    queryFn: () => api.get<Deck>(`/decks/${id}`),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deck", id] });
      qc.invalidateQueries({ queryKey: ["decks", "mine"] });
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
