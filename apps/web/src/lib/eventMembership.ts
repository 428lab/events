import type { EventMemberWithUser, User } from "@eventer/shared";

/**
 * 「この申込は自分のものか」の判定 (#466)。
 *
 * 突き合わせるのは membership 自身の `userId`。`user` は一覧に名前とアバターを
 * 出すためにサーバーが結合してきた行なので、`user.id` で突き合わせると
 * **結合の仕方に寄りかかった判定**になる。今どちらでも同じ答えになるのは
 * サーバーの SQL がそう結合しているからで、型がそれを保証してはいない
 * （`eventMemberWithUser` は `userId` と `user` を別々に持つ）。
 *
 * 綴りが増えると、片方だけ直したときに「自分の申込が見つからない」という
 * 静かな壊れ方をする。呼ぶ側が綴りを選べないよう、判定はここだけに置く。
 */
export function isMyMembership(
  member: EventMemberWithUser,
  me: User | null | undefined,
): boolean {
  return Boolean(me) && member.userId === me!.id;
}

/** 参加者一覧から自分の申込を探す。未ログイン・読込前は undefined */
export function findMyMembership(
  members: EventMemberWithUser[] | undefined,
  me: User | null | undefined,
): EventMemberWithUser | undefined {
  return members?.find((m) => isMyMembership(m, me));
}
