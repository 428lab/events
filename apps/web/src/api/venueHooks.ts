import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateVenueInput,
  UpdateVenueInput,
  Venue,
  VenueOwnerView,
} from "@eventer/shared";
import { api } from "./client.js";

/** 会場マッチング (#53) */

export function venueImageUrl(v: Venue): string | null {
  return v.imageUpdatedAt
    ? `/api/venues/${v.id}/image?v=${v.imageUpdatedAt}`
    : null;
}

export function usePublicVenues(page: number) {
  return useQuery({
    queryKey: ["venues", page],
    queryFn: () =>
      api.get<{ venues: Venue[]; total: number; limit: number }>(
        `/public/venues?page=${page}`,
      ),
  });
}

export function useVenue(id: string) {
  return useQuery({
    queryKey: ["venue", id],
    enabled: Boolean(id),
    retry: false,
    queryFn: () =>
      api.get<{
        venue: Venue | VenueOwnerView;
        owner: {
          id: string;
          username: string;
          globalName: string | null;
          avatarUrl: string | null;
        } | null;
        isOwner: boolean;
      }>(`/public/venues/${id}`),
  });
}

export function useMyVenues(enabled = true) {
  return useQuery({
    queryKey: ["myVenues"],
    enabled,
    queryFn: async () =>
      (await api.get<{ venues: VenueOwnerView[] }>("/venues/mine")).venues,
  });
}

export function useCreateVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVenueInput) =>
      api.post<{ venue: VenueOwnerView }>("/venues", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venues"] });
      void qc.invalidateQueries({ queryKey: ["myVenues"] });
    },
  });
}

export function useUpdateVenue(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVenueInput) =>
      api.patch<{ venue: VenueOwnerView }>(`/venues/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venue", id] });
      void qc.invalidateQueries({ queryKey: ["venues"] });
      void qc.invalidateQueries({ queryKey: ["myVenues"] });
    },
  });
}

export function useDeleteVenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/venues/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venues"] });
      void qc.invalidateQueries({ queryKey: ["myVenues"] });
    },
  });
}
