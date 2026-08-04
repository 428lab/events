#!/usr/bin/env node
/**
 * Nostr vanity npub マイナー（マルチコア）
 * 使い方: node scripts/mine-npub.mjs <bech32プレフィックス> [個数=1]
 *   例: node scripts/mine-npub.mjs evl 2
 * 見つかった鍵は標準出力にのみ表示される（どこにも保存しない）。
 * bech32で使える文字: qpzry9x8gf2tvdw0s3jn54khce6mua7l （b,i,o,1 は使えない）
 * 目安: 3文字=数秒 / 4文字=数十秒 / 5文字=数十分 / 6文字=数時間〜（コア数依存）
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

if (isMainThread) {
  const prefix = process.argv[2];
  const count = Number(process.argv[3] ?? "1");
  const BECH32 = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
  if (!prefix || !BECH32.test(prefix)) {
    console.error("プレフィックスは bech32 文字（qpzry9x8gf2tvdw0s3jn54khce6mua7l）のみで指定してください");
    process.exit(1);
  }
  const cores = Math.max(1, os.cpus().length - 1);
  console.error(`npub1${prefix}... を ${cores} コアで探索中（${count}個見つけたら終了）`);
  let found = 0;
  let total = 0;
  const started = Date.now();
  const workers = [];
  for (let i = 0; i < cores; i++) {
    const w = new Worker(__filename, { workerData: { prefix } });
    workers.push(w);
    w.on("message", (msg) => {
      if (msg.type === "progress") {
        total += msg.n;
        const rate = Math.round(total / ((Date.now() - started) / 1000));
        process.stderr.write(`\r試行 ${total.toLocaleString()} 回 (${rate.toLocaleString()}/s)   `);
      } else if (msg.type === "found") {
        found++;
        console.log(`\n--- HIT ${found} ---`);
        console.log(`npub : ${msg.npub}`);
        console.log(`nsec : ${msg.nsec}   ← 絶対に共有しないこと`);
        console.log(`hexpub: ${msg.hexpub}`);
        if (found >= count) {
          for (const x of workers) x.terminate();
          process.exit(0);
        }
      }
    });
  }
} else {
  const { generateSecretKey, getPublicKey, nip19 } = await import(
    new URL("../apps/web/node_modules/nostr-tools/lib/esm/index.js", import.meta.url)
  );
  const { prefix } = workerData;
  const want = "npub1" + prefix;
  let n = 0;
  for (;;) {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const npub = nip19.npubEncode(pk);
    n++;
    if (npub.startsWith(want)) {
      parentPort.postMessage({
        type: "found",
        npub,
        nsec: nip19.nsecEncode(sk),
        hexpub: pk,
      });
    }
    if (n % 20000 === 0) {
      parentPort.postMessage({ type: "progress", n });
      n = 0;
    }
  }
}
