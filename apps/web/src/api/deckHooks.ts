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
