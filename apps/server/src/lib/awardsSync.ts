import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { AWARDS_SYNC_KIND, type AwardsSyncConfig, type Event } from "@eventer/shared";
import { getChatRelays } from "../db/repositories/appSettings.js";
import { env } from "../runtime.js";
import { servicePubkey, signWithServiceKey } from "./nostrSign.js";
import { nostrRelay } from "./nostrRelay.js";

type TopicEvent = Pick<Event, "id" | "accessRevision">;

/** A topic is only a wake-up address, never permission to read an event. */
export const awardsSync = {
  async config(event: TopicEvent): Promise<AwardsSyncConfig | null> {
    const pubkey = servicePubkey();
    if (!pubkey) return null;
    const topic = bytesToHex(hmac(sha256, hexToBytes(env.nostrServiceKey),
      utf8ToBytes(`eventer/awards-sync/v1:${event.id}:${event.accessRevision}`)));
    return { topic, kind: AWARDS_SYNC_KIND, pubkey, relays: await getChatRelays() };
  },

  /** Called only after the authorized cursor write has committed. */
  async publish(event: TopicEvent): Promise<void> {
    try {
      const config = await this.config(event);
      if (!config) return;
      const signal = signWithServiceKey({
        kind: config.kind,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", config.topic], ["nonce", crypto.randomUUID()]],
        content: "",
      });
      const report = await nostrRelay.publishToRelays(config.relays, signal, signWithServiceKey);
      if (!report.ok) console.warn("Awards update signal was not accepted; polling remains active");
    } catch {
      // A relay failure must not turn an already committed advance into a failed operation.
      console.warn("Awards update signal failed; polling remains active");
    }
  },
};
