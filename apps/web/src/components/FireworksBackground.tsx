import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
interface Rocket {
  x: number;
  y: number;
  vy: number;
  color: string;
}

/**
 * 背景にかすかに打ち上がる花火（軽量canvas）。
 * コンテンツの後ろ側に透過で控えめに表示する（z-index:0・低opacity）。
 * 打ち上げ→上昇→頂点で開く、を数秒に1発の低頻度で。
 */
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
    let rockets: Rocket[] = [];
    let raf = 0;
    let last = performance.now();
    let nextLaunch = last + 1500;

    const pickColor = () => {
      const cs = colorsRef.current;
      return cs[Math.floor(Math.random() * cs.length)];
    };

    const launch = () => {
      rockets.push({
        x: w * (0.18 + Math.random() * 0.64),
        y: h,
        vy: -(9 + Math.random() * 4),
        color: pickColor(),
      });
    };

    const explode = (x: number, y: number, color: string) => {
      const n = 30 + Math.floor(Math.random() * 20);
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n;
        const sp = 1.4 + Math.random() * 2.6;
        particles.push({
          x,
          y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: 1,
          color,
        });
      }
    };

    const tick = (now: number) => {
      last = now;
      if (now >= nextLaunch) {
        launch();
        // 低頻度: 3.5〜6.5秒に1発
        nextLaunch = now + 3500 + Math.random() * 3000;
      }
      ctx.clearRect(0, 0, w, h);

      // ロケット（打ち上げ）
      rockets = rockets.filter((r) => {
        r.y += r.vy;
        r.vy += 0.12; // 減速
        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 8;
        ctx.shadowColor = r.color;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2, 0, Math.PI * 2);
        ctx.fill();
        if (r.vy >= -0.8) {
          explode(r.x, r.y, r.color);
          return false;
        }
        return r.y > 0;
      });

      // 開いた火花
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.life -= 0.011;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.shadowBlur = 6;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
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
        zIndex: 0,
        opacity: 0.32,
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
