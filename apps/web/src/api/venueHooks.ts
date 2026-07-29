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
        isManager?: boolean;
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

/** ---- 管理者 (#67) ---- */
export interface VenueAdmin {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export function useVenueAdmins(venueId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["venueAdmins", venueId],
    enabled: enabled && Boolean(venueId),
    queryFn: async () =>
      (await api.get<{ admins: VenueAdmin[] }>(`/venues/${venueId}/admins`)).admins,
  });
}

export function useAddVenueAdmin(venueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) =>
      api.post<{ admins: VenueAdmin[] }>(`/venues/${venueId}/admins`, { handle }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["venueAdmins", venueId] }),
  });
}

export function useRemoveVenueAdmin(venueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.del<{ admins: VenueAdmin[] }>(`/venues/${venueId}/admins/${userId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["venueAdmins", venueId] }),
  });
}

export function useTransferVenue(venueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<{ ok: boolean }>(`/venues/${venueId}/transfer`, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venue", venueId] });
      void qc.invalidateQueries({ queryKey: ["venueAdmins", venueId] });
      void qc.invalidateQueries({ queryKey: ["myVenues"] });
    },
  });
}

/** ---- オファー (#53 PR2) ---- */

export interface EnrichedVenueOffer {
  id: string;
  venueId: string;
  eventId: string | null;
  requestId: string | null;
  direction: "venue_to_event" | "event_to_venue";
  status: "pending" | "accepted" | "declined";
  organizerContact: string;
  createdBy: string;
  createdAt: number;
  venue: { id: string; name: string; area: string } | null;
  event: { id: string; title: string } | null;
  request: { id: string; title: string } | null;
  venueContact: string;
  venueAddress: string;
}

/** 会場を探しているイベント・たまご（会場オーナー向け募集一覧） */
export function useVenueWanted() {
  return useQuery({
    queryKey: ["venueWanted"],
    queryFn: () =>
      api.get<{ events: import("@eventer/shared").Event[]; requests: import("@eventer/shared").EventRequest[] }>(
        "/public/venues/wanted",
      ),
  });
}

export function useVenueOffers(
  kind: "for-venue" | "for-event" | "for-request",
  id: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["venueOffers", kind, id],
    enabled: enabled && Boolean(id),
    queryFn: async () =>
      (await api.get<{ offers: EnrichedVenueOffer[] }>(`/venue-offers/${kind}/${id}`))
        .offers,
  });
}

export function useCreateVenueOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      venueId: string;
      eventId?: string;
      requestId?: string;
      contact?: string;
    }) => api.post<{ offer: unknown }>("/venue-offers", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venueOffers"] });
    },
  });
}

export function useRespondVenueOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      offerId,
      action,
      contact,
    }: {
      offerId: string;
      action: "accept" | "decline";
      contact?: string;
    }) =>
      api.post<{ ok: boolean }>(`/venue-offers/${offerId}/respond`, {
        action,
        contact,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["venueOffers"] });
    },
  });
}
