import { useRef } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { encodeImageForUpload } from "../encodeImage.js";

/**
 * 編集画面での画像の差し込み。
 *
 * 「新しく置く」と「差し替える」で入口が2つあるが、選ばせる・縮める・上げる手順は
 * 同じなので1か所に置く。受け取り先だけ pick に渡してもらう。
 * 隠しファイル入力は画面ごとに1つあればよいので、返した input を1回描いてもらう。
 */
export function useImagePicker(
  upload: (file: Blob) => Promise<{ url: string }>,
): { input: ReactElement; pick: (onPicked: (url: string) => void) => void } {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const receiver = useRef<(url: string) => void>(() => {});

  const pick = (onPicked: (url: string) => void) => {
    receiver.current = onPicked;
    inputRef.current?.click();
  };

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルをもう一度選んでも change が起きるように空にしておく
    e.target.value = "";
    if (!file) return;
    try {
      const encoded = await encodeImageForUpload(file);
      const { url } = await upload(encoded);
      receiver.current(url);
    } catch {
      window.alert(t("studio.imageUploadFailed"));
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={onChange}
    />
  );

  return { input, pick };
}
