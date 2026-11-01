import { z } from "zod";

/**
 * 公開プロフィールに出す「連携しているアカウント」へのリンク (docs/profile-social-links.md)。
 *
 * 本人がアカウント設定で「プロフィールに表示する」をオンにした連携だけを出す（オプトイン）。
 * 出せる連携先と URL の作り方はここが唯一の定義で、サーバーはここで作った URL だけを
 * 公開プロフィールに載せる（連携先の生の ID を画面へ渡して組み立てさせない）。
 *
 * - GitHub: https://github.com/<login>。login はログイン・連携のたびに保存する
 *   （識別子の数値IDでは開けない）
 * - X: https://x.com/<username>。username が無いときは数値IDの https://x.com/i/user/<id>
 * - Bluesky: https://bsky.app/profile/<DID>。ハンドルは変わるので URL は DID で作り、
 *   ハンドルは表示にだけ使う
 * - Nostr: https://njump.me/<npub>。公開鍵から npub を作る
 *
 * 出さないもの: Google（公開プロフィールが無い）、Discord（discord.com/users/<id> は
 * 同じサーバーにいる人など一部にしか開けず、知らない人には「開けないリンク」になる）
 */
export const PROFILE_LINK_PROVIDERS = ["github", "x", "bluesky", "nostr"] as const;
export type ProfileLinkProvider = (typeof PROFILE_LINK_PROVIDERS)[number];

export function isProfileLinkProvider(p: string): p is ProfileLinkProvider {
  return (PROFILE_LINK_PROVIDERS as readonly string[]).includes(p);
}

export const profileLinkSchema = z.object({
  provider: z.enum(PROFILE_LINK_PROVIDERS),
  url: z.string(),
  /** 表示名（@login、ハンドル、npub の短縮など） */
  label: z.string(),
});
export type ProfileLink = z.infer<typeof profileLinkSchema>;

// 連携先のユーザー名として受け入れる形。外れた値は「名前が分からない」扱いにする
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const X_ID = /^\d{1,20}$/;
const BSKY_HANDLE = /^(?=.{3,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const BSKY_DID = /^did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.-]+)$/;
const NOSTR_PUBKEY = /^[0-9a-f]{64}$/;

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

/** 32バイトの公開鍵(hex)を NIP-19 の npub にする。形が違えば null */
export function npubEncode(pubkeyHex: string): string | null {
  if (!NOSTR_PUBKEY.test(pubkeyHex)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(pubkeyHex.slice(i, i + 2), 16));
  // 8bit → 5bit
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const hrp = "npub";
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = bech32Polymod([...hrpExpand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join("");
}

/** 連携1件からリンクを作る。作れない（名前が無い・形が違う）ときは null */
export function profileLinkFor(
  provider: string,
  providerUserId: string,
  publicHandle: string | null,
): ProfileLink | null {
  switch (provider) {
    case "github":
      if (!publicHandle || !GITHUB_LOGIN.test(publicHandle)) return null;
      return { provider, url: `https://github.com/${publicHandle}`, label: `@${publicHandle}` };
    case "x":
      if (publicHandle && X_USERNAME.test(publicHandle)) {
        return { provider, url: `https://x.com/${publicHandle}`, label: `@${publicHandle}` };
      }
      if (!X_ID.test(providerUserId)) return null;
      return { provider, url: `https://x.com/i/user/${providerUserId}`, label: "X" };
    case "bluesky": {
      if (!BSKY_DID.test(providerUserId)) return null;
      const handle = publicHandle && BSKY_HANDLE.test(publicHandle) ? publicHandle : null;
      return {
        provider,
        url: `https://bsky.app/profile/${providerUserId}`,
        label: handle ? `@${handle}` : "Bluesky",
      };
    }
    case "nostr": {
      const npub = npubEncode(providerUserId);
      if (!npub) return null;
      return { provider, url: `https://njump.me/${npub}`, label: `${npub.slice(0, 12)}…${npub.slice(-4)}` };
    }
    default:
      return null;
  }
}

/** 公開/非公開の切り替え入力 */
export const setIdentityProfilePublicInput = z.object({ profilePublic: z.boolean() });
export type SetIdentityProfilePublicInput = z.infer<typeof setIdentityProfilePublicInput>;
