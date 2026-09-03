#!/usr/bin/env node
/**
 * server のテストを、同時に立つ workerd の数を抑えて流す (#371)。
 *
 * ## なぜ要るか
 *
 * @cloudflare/vitest-pool-workers は isolatedStorage（既定 ON・テスト間で
 * DB を巻き戻す仕組み。うちのテストはこれに依存している）のとき、
 * **テストファイル1本につき workerd を1プロセス立て、全ファイルを同時に走らせる**。
 * 本数の上限は無く、vitest の maxWorkers も fileParallelism も効かない
 * （pool 側が specs を丸ごと受け取って Promise.allSettled で一斉に流すため）。
 *
 * その結果、テストファイルが62本あれば **workerd が62プロセス同時に立ち、
 * 62本のテストが一斉に走る**。CI の runner は 4 vCPU しかないので、
 * 1テストが数百ms から 6〜15秒まで伸び、割を食ったリクエストが
 * `Network connection lost.` で落ちる。落ちるテストは毎回ちがう＝
 * 変更と無関係に落ちる、という壊れ方になる。
 *
 * ## どう抑えるか
 *
 * vitest の --shard でテストファイルを分割し、**1回に走らせるファイル数が
 * MAX_FILES_AT_ONCE を超えないように**、シャードを順番に流す。
 * シャード1本ぶんの vitest しか動かないので、同時に立つ workerd も
 * MAX_FILES_AT_ONCE 本までに収まる。
 *
 * 上限は実行環境で変えず、常に同じ数にしている。CPU 数に比例させると
 * 手元では数十プロセス立ってしまい、「テストを回すのは常に1体」という
 * 運用の申し合わせに頼ることになる。守りたいのは相対値ではなく
 * 「立ち上がる workerd の絶対数」なので、契約は1つにする。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** 同時に走らせるテストファイル数の上限 ＝ 同時に立つ workerd の数の上限。
 * CI の runner は 4 vCPU なので、1コアあたり2本ぶんに収める */
const MAX_FILES_AT_ONCE = 8;

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = path.join(serverDir, "node_modules/vitest/vitest.mjs");
// `pnpm test -- <filter>` のような追加引数はそのまま渡す
const passthrough = process.argv.slice(2);

function vitest(args, opts = {}) {
  const res = spawnSync(process.execPath, [vitestBin, ...args], {
    cwd: serverDir,
    stdio: "inherit",
    ...opts,
  });
  if (res.error) throw res.error;
  return res;
}

// 何本あるかを先に数える。--filesOnly は pool を起動しない（workerd は立たない）ので
// ここでは資源を使わない。
// --json は直後の引数を「出力先ファイルのパス」として食う（そこに上書き保存する）
// ため、フィルタ引数より**後ろ**に置くこと。前に置くと
// `pnpm test -- test/foo.test.ts` が foo.test.ts を JSON で潰す
const list = vitest(["list", "--filesOnly", ...passthrough, "--json"], {
  stdio: ["ignore", "pipe", "inherit"],
  encoding: "utf8",
});
if (list.status !== 0) process.exit(list.status ?? 1);

const fileCount = JSON.parse(list.stdout).length;
if (fileCount === 0) {
  console.error("テストファイルが見つからなかった");
  process.exit(1);
}

const shards = Math.ceil(fileCount / MAX_FILES_AT_ONCE);
console.log(
  `テストファイル ${fileCount} 本を ${shards} 回に分けて流す` +
    `（1回あたり最大 ${MAX_FILES_AT_ONCE} 本 = workerd ${MAX_FILES_AT_ONCE} プロセス）`,
);

// 途中で落ちても最後まで流す。1回目で止めると「他にも落ちているか」が分からず、
// 直すのに何度も回す羽目になる
const failed = [];
for (let i = 1; i <= shards; i++) {
  console.log(`\n===== シャード ${i}/${shards} =====`);
  const { status } = vitest(["run", `--shard=${i}/${shards}`, ...passthrough]);
  if (status !== 0) failed.push(i);
}

if (failed.length > 0) {
  console.error(`\n落ちたシャード: ${failed.join(", ")} / ${shards}`);
  process.exit(1);
}
console.log(`\n全 ${shards} シャード通過`);
