import { useEffect, useRef, useState } from "react";

/**
 * 背面カメラを起動して QR を読み続ける (#154 → #704)。
 * 受付リーダー（CheckinPage）と出会いのQR画面（BigQrDialog）で共通に使う。
 * デコードはネイティブ BarcodeDetector を優先し、無ければ jsQR にフォールバックする。
 *
 * - onDecode は ref 経由で最新を呼ぶ（効果の依存に入れると、呼び出し側の再描画のたびに
 *   カメラが止まって開き直しになる）
 * - pausedRef.current が true の間はデコードしない（結果表示中など）
 * - enabled が false になったら・アンマウントしたらカメラを止める
 */

/** BarcodeDetector の最小型（TS の lib.dom にまだ無い） */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export function useQrScanner({
  enabled,
  onDecode,
  pausedRef,
}: {
  enabled: boolean;
  onDecode: (text: string) => void;
  pausedRef?: { readonly current: boolean };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 文言は呼び出し側で決める。ここでは使えなかったことだけ持つ
  const [cameraError, setCameraError] = useState(false);

  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const pausedRefRef = useRef(pausedRef);
  pausedRefRef.current = pausedRef;

  // カメラ起動＋デコードループ（約10fps）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    setCameraError(false);

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        if (!cancelled) setCameraError(true);
        return;
      }
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      // ネイティブ BarcodeDetector（対応環境）を優先。無ければ jsQR を遅延読み込み
      let detector: BarcodeDetectorLike | null = null;
      const Ctor = (window as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;
      if (Ctor) {
        try {
          const formats = (await Ctor.getSupportedFormats?.()) ?? [];
          if (formats.includes("qr_code")) {
            detector = new Ctor({ formats: ["qr_code"] });
          }
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      if (cancelled) return;

      timer = window.setInterval(async () => {
        if (pausedRefRef.current?.current) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        let text: string | null = null;
        if (detector) {
          try {
            const codes = await detector.detect(v);
            text = codes[0]?.rawValue ?? null;
          } catch {
            text = null;
          }
        } else if (jsQR && canvasRef.current) {
          // デコード負荷を抑えるため長辺640pxに縮小してから読む
          const canvas = canvasRef.current;
          const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, {
            inversionAttempts: "dontInvert",
          });
          text = code?.data ?? null;
        }
        if (text && !cancelled) onDecodeRef.current(text);
      }, 100);
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled]);

  return { videoRef, canvasRef, cameraError };
}
