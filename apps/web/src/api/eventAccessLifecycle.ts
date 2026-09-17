import type { QueryClient, Query } from "@tanstack/react-query";
import { ApiError, invalidateEventResponses } from "./client.js";

const sensitiveRoots = new Set(["event", "eventInvites", "eventAccess", "myStaffInvites", "eventSchedule", "eventNameCards", "eventBySlug", "myPage", "notifications", "venueOffers", "moderationContent", "pre-survey", "community", "communityEventSearch"]);
/** Installed once per QueryClient. Cancel before clearing: an older response must
 * never repopulate another account's cache. Public discovery/offline data stays. */
export function installEventAccessLifecycle(client: QueryClient) {
  let identity = (client.getQueryData(["me"]) as {user?: {id:string}} | undefined)?.user?.id;
  const revisions = new Map<string, number>();
  let clearing = false;
  const clear = (predicate: (q: Query) => boolean, eventId?: string) => {
    clearing = true;
    invalidateEventResponses(eventId);
    void client.cancelQueries({predicate}, {revert:false});
    for (const query of client.getQueryCache().findAll({predicate})) query.setState({data:undefined,dataUpdatedAt:0,error:null,status:"pending",fetchStatus:"idle"});
    client.removeQueries({predicate});
    clearing = false;
  };
  return client.getQueryCache().subscribe(({query, type}) => {
    if (clearing || type !== "updated") return;
    const key = query.queryKey;
    if (key[0] === "me" && key.length === 1 && query.state.status === "success") {
      const next = (query.state.data as {user?: {id:string}} | null)?.user?.id;
      if (next !== identity) { identity = next; revisions.clear(); clear(q => sensitiveRoots.has(String(q.queryKey[0])) || (q.queryKey[0] === "me" && q.queryKey.length > 1)); }
    }
    // Community detail/search can now hold private events. Drop failed snapshots,
    // while retaining the error state so the existing UI can offer retry.
    if ((key[0] === "communityEventSearch" || (key[0] === "community" && key[2] === "viewer"))
      && query.state.status === "error" && query.state.data !== undefined) {
      query.setState({ data: undefined, dataUpdatedAt: 0 });
    }
    if (key[0] !== "event" || key[2] !== "viewer") return;
    const id = String(key[1]);
    const event = (query.state.data as {event?: {visibility:string;accessRevision:number}} | undefined)?.event;
    if (query.state.status === "error") {
      const error = query.state.error;
      if (event?.visibility !== "public" || (error instanceof ApiError && [401,403,404].includes(error.status))) {
        clear(q => (q.queryKey[0] === "event" && q.queryKey[1] === id) || ["eventInvites","eventAccess","eventSchedule","eventNameCards","community","communityEventSearch"].includes(String(q.queryKey[0])), id);
      }
    } else if (query.state.status === "success" && event) {
      const previous = revisions.get(id);
      revisions.set(id, event.accessRevision);
      if (previous !== undefined && previous !== event.accessRevision) {
        clear(q => q !== query && ((q.queryKey[0] === "event" && q.queryKey[1] === id) || ["eventSchedule","eventNameCards","community","communityEventSearch"].includes(String(q.queryKey[0]))), id);
      }
    }
  });
}
