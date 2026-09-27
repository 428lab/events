import { useEffect, useState } from "react";
import type { CutinAction } from "@eventer/shared";
import { useTranslation } from "react-i18next";
import "./LiveCutin.css";

/** The name/message are React text nodes, never markup or an image of sample lettering. */
export function LiveCutin({ action }: { action: Pick<CutinAction, "message"> }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  const [fontFailed, setFontFailed] = useState(false);
  useEffect(() => {
    if (!document.fonts) return;
    let mounted = true;
    void document.fonts.load('40px "Yuji Syuku Cutin"').then(faces => {
      if (mounted && faces.length === 0) setFontFailed(true);
    }).catch(() => { if (mounted) setFontFailed(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 3000 : 3500);
    return () => clearTimeout(timer);
  }, [action.message]);
  if (!visible) return null;
  return <div className={`live-cutin${fontFailed ? " live-cutin--static" : ""}`} data-testid="live-cutin" role="status" aria-label={action.message}>
    <div className="live-cutin-band" />
    <svg className="live-cutin-brush" viewBox="0 0 960 540" preserveAspectRatio="none" aria-hidden="true">
      <path d="M-45 410 Q170 335 377 260 T1015 86" />
      <path d="M-22 443 Q258 376 573 249 T1017 124" />
      <path d="M116 470 Q425 357 791 203 T1005 150" />
      <path className="live-cutin-edge" d="M-60 453 Q274 386 584 250 T1010 116" />
    </svg>
    <div className="live-cutin-words"><span className="live-cutin-label">SPECIAL ENTRANCE <i /> {t("studio.cutinLabel")}</span><strong>{action.message}</strong><span className="live-cutin-rule" /></div>
  </div>;
}
