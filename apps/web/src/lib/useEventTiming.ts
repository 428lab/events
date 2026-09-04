import { useEffect, useState } from "react";
import type { Event } from "@eventer/shared";
import { formatRemaining } from "./format.js";

/** 残り時間を強調に切り替える境目（締切24時間前） */
const DEADLINE_SOON_MS = 86400000;

export interface EventTiming {
  /** 終了済みか。サーバー側 isEventEnded と同じ判定 */
  ended: boolean;
  /** 募集を締め切ったか。サーバー側 isRegistrationClosed と同じ判定 */
  registrationClosed: boolean;
  /** 締切24時間前を切ったときだけ残り時間。それ以外は空文字 */
  deadlineRemaining: string;
  /** 時計を今に進める。サーバーに締切・終了で断られた直後に呼ぶ */
  refresh: () => void;
}

/**
 * 終了・募集締切の判定をまとめたフック (#269)。
 *
 * 判定そのものはサーバーの isEventEnded / isRegistrationClosed と対になっており、
 * 画面のあちこちで同じ式を書き直さないためにここ1か所に置く。
 *
 * 時計を内側に持つのは、開いたままのページでも締切・終了をまたいだら表示が
 * 切り替わるようにするため。秒単位で刻む必要はない（表示の粒度が分・時間なので）。
 * 呼び出し側は1回だけ呼んで結果を配る。2か所で呼ぶと時計がずれる。
 */
export function useEventTiming(event: Event | null | undefined): EventTiming {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // 日程調整中（endsAt未確定=0）は終了扱いしない
  const ended = event ? !event.scheduling && event.endsAt < now : false;
  // 締切が未設定（null）なら締切なしで、従来どおり終了まで受け付ける
  const deadline = event?.registrationDeadline ?? null;
  const registrationClosed = deadline !== null && deadline <= now;
  const deadlineRemaining =
    deadline !== null && !registrationClosed && deadline - now < DEADLINE_SOON_MS
      ? formatRemaining(deadline, now)
      : "";

  return {
    ended,
    registrationClosed,
    deadlineRemaining,
    refresh: () => setNow(Date.now()),
  };
}
