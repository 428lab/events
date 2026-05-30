import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/** 背景に打ち上がる花火（軽量なcanvasアニメ）。コンテンツの後ろに固定表示。 */
export function FireworksBackground({ colors }: { colors: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    let particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const explode = () => {
      const cs = colorsRef.current;
      const color = cs[Math.floor(Math.random() * cs.length)];
      const cx = w * (0.15 + Math.random() * 0.7);
      const cy = h * (0.1 + Math.random() * 0.4);
      const n = 36 + Math.floor(Math.random() * 24);
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n;
        const sp = 1.5 + Math.random() * 3;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: 1,
          color,
        });
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(now - last, 60);
      last = now;
      acc += dt;
      // 約1.1秒ごとに打ち上げ（タブ非表示時は描画自体が止まる）
      if (acc > 900) {
        acc = 0;
        explode();
      }
      ctx.clearRect(0, 0, w, h);
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02; // 重力
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.life -= 0.012;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        // コンテンツより前面に薄く重ねる（クリックは透過）。MUIのモーダル(1300)より下。
        zIndex: 1200,
        opacity: 0.6,
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
