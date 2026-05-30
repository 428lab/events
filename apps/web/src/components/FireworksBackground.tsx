import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  gravity: number;
  size: number;
  color: string;
}
interface Rocket {
  x: number;
  y: number;
  vy: number;
  color: string;
}

type Pattern = "burst" | "ring" | "double" | "willow";

/**
 * 背景にかすかに打ち上がる花火（軽量canvas）。
 * 低頻度・打ち上げアニメ付き・大きさ/パターンにバリエーション・落下しながらゆっくり消える。
 * コンテンツの後ろ側に透過で控えめに表示（z-index:0・低opacity）。
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
    let nextLaunch = performance.now() + 1200;

    const pick = () => {
      const cs = colorsRef.current;
      return cs[Math.floor(Math.random() * cs.length)];
    };

    const add = (
      x: number,
      y: number,
      ang: number,
      sp: number,
      color: string,
      opts: { decay?: number; gravity?: number; size?: number; downBias?: number } = {},
    ) => {
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + (opts.downBias ?? 0),
        life: 1,
        decay: opts.decay ?? 0.005,
        gravity: opts.gravity ?? 0.03,
        size: opts.size ?? 2.2,
        color,
      });
    };

    const explode = (x: number, y: number, baseColor: string) => {
      const patterns: Pattern[] = ["burst", "ring", "double", "willow"];
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      const scale = 0.6 + Math.random() * 1.4; // 小〜大
      const size = 1.6 + scale * 1.1;

      if (pattern === "ring") {
        const n = Math.round(46 + scale * 14);
        const sp = 2.6 * scale;
        for (let i = 0; i < n; i++) add(x, y, (Math.PI * 2 * i) / n, sp, baseColor, { size });
      } else if (pattern === "double") {
        const c2 = pick();
        const n = Math.round(34 + scale * 10);
        for (let i = 0; i < n; i++) {
          add(x, y, (Math.PI * 2 * i) / n, 1.8 * scale, baseColor, { size });
          add(x, y, (Math.PI * 2 * i) / n + 0.1, 3.4 * scale, c2, { size: size * 0.85 });
        }
      } else if (pattern === "willow") {
        // しだれ: ゆっくり長く落ちる
        const n = Math.round(26 + scale * 10);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n, 1.6 * scale, baseColor, {
            decay: 0.0032,
            gravity: 0.05,
            size: size * 0.9,
            downBias: 0.6,
          });
      } else {
        // burst: 速度ばらつきで密度のある球状
        const n = Math.round(40 + scale * 18);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n, (1 + Math.random() * 3) * scale, baseColor, { size });
      }
    };

    const tick = (now: number) => {
      if (now >= nextLaunch) {
        rockets.push({
          x: w * (0.16 + Math.random() * 0.68),
          y: h,
          vy: -(9 + Math.random() * 5),
          color: pick(),
        });
        nextLaunch = now + 3500 + Math.random() * 3000;
      }
      ctx.clearRect(0, 0, w, h);

      rockets = rockets.filter((r) => {
        r.y += r.vy;
        r.vy += 0.12;
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

      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity; // 落下
        p.vx *= 0.986;
        p.vy *= 0.992;
        p.life -= p.decay;
        // 終盤はチカチカ瞬く
        const twinkle = p.life < 0.35 ? 0.5 + Math.random() * 0.5 : 1;
        ctx.globalAlpha = Math.max(0, p.life) * twinkle;
        ctx.shadowBlur = 6;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
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
        opacity: 0.34,
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
