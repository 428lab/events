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
  glitter: boolean; // 落下後に強く瞬く（千輪/しだれ）
}
interface Rocket {
  x: number;
  y: number;
  vy: number;
  color: string;
}

type Pattern =
  | "peony"
  | "chrysanthemum"
  | "ring"
  | "double"
  | "willow"
  | "palm"
  | "crackle";

/**
 * 背景の花火（軽量canvas）。
 * 尾を引く描画(加算合成+残像フェード)、複数パターン、落下後に瞬くグリッター。
 * コンテンツ後ろに透過で控えめ表示（z-index:0・低opacity）、低頻度・打ち上げアニメ付き。
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
    let nextLaunch = performance.now() + 1000;

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
      o: {
        decay?: number;
        gravity?: number;
        size?: number;
        downBias?: number;
        glitter?: boolean;
      } = {},
    ) => {
      particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp + (o.downBias ?? 0),
        life: 1,
        decay: o.decay ?? 0.006,
        gravity: o.gravity ?? 0.03,
        size: o.size ?? 2,
        color,
        glitter: o.glitter ?? false,
      });
    };

    const explode = (x: number, y: number, baseColor: string) => {
      const patterns: Pattern[] = [
        "peony",
        "chrysanthemum",
        "ring",
        "double",
        "willow",
        "palm",
        "crackle",
      ];
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];
      const scale = 1.0 + Math.random() * 1.4;
      const size = 1.7 + scale;

      // 6割はカラフル（粒ごとにパレットから多色）、4割は単色でメリハリ
      const multi = Math.random() < 0.6;
      // カラフル時は数色をシャッフルして使う
      const palette = colorsRef.current;
      const col = () => (multi ? palette[Math.floor(Math.random() * palette.length)] : baseColor);

      // 開いた瞬間の芯
      for (let i = 0; i < 12; i++)
        add(x, y, Math.random() * Math.PI * 2, Math.random() * 1.4, "#FFFFFF", {
          decay: 0.04,
          gravity: 0.01,
          size: size,
        });

      if (pattern === "ring") {
        // リング: 角度ごとに色相を回す（カラフルな環）
        const n = Math.round(72 + scale * 18);
        const sp = 3 * scale;
        for (let i = 0; i < n; i++) {
          const c = multi ? palette[i % palette.length] : baseColor;
          add(x, y, (Math.PI * 2 * i) / n, sp + Math.random() * 0.3, c, { size });
        }
      } else if (pattern === "double") {
        // 多重: 3色の同心リング
        const cs = [baseColor, pick(), pick()];
        const n = Math.round(40 + scale * 12);
        cs.forEach((c, ring) => {
          const sp = (1.6 + ring * 1.2) * scale;
          for (let i = 0; i < n; i++)
            add(x, y, (Math.PI * 2 * i) / n + ring * 0.1, sp, c, { size: size * (1 - ring * 0.1) });
        });
      } else if (pattern === "willow") {
        const n = Math.round(54 + scale * 16);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n, (1.7 + Math.random() * 0.7) * scale, col(), {
            decay: 0.003,
            gravity: 0.06,
            size: size * 0.95,
            downBias: 0.6,
            glitter: true,
          });
      } else if (pattern === "palm") {
        const n = Math.round(10 + scale * 4);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n + Math.random() * 0.1, (3.5 + Math.random() * 1.5) * scale, col(), {
            decay: 0.0045,
            gravity: 0.05,
            size: size * 1.4,
          });
      } else if (pattern === "crackle") {
        const n = Math.round(80 + scale * 30);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n + Math.random() * 0.2, (1.2 + Math.random() * 2.6) * scale, col(), {
            decay: 0.004,
            size: size * 0.85,
            glitter: true,
          });
      } else if (pattern === "chrysanthemum") {
        const n = Math.round(80 + scale * 26);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n, (1.6 + Math.random() * 2.4) * scale, col(), {
            decay: 0.0045,
            size,
          });
      } else {
        // 牡丹: 密度のある球状
        const n = Math.round(90 + scale * 36);
        for (let i = 0; i < n; i++)
          add(x, y, (Math.PI * 2 * i) / n + Math.random() * 0.2, (1.2 + Math.random() * 3.2) * scale, col(), { size });
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
        nextLaunch = now + 3000 + Math.random() * 2800;
      }

      // 残像を少し残してフェード（尾を引く）
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(0, 0, w, h);

      // 加算合成で発光感
      ctx.globalCompositeOperation = "lighter";

      rockets = rockets.filter((r) => {
        r.y += r.vy;
        r.vy += 0.12;
        ctx.globalAlpha = 0.9;
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
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.vy *= 0.99;
        p.life -= p.decay;

        let a = Math.max(0, p.life);
        if (p.glitter && p.life < 0.6) {
          // 落下後に強く瞬く
          a = Math.random() < 0.5 ? Math.min(1, a * 2) : a * 0.15;
        } else if (p.life < 0.3) {
          a *= 0.6 + Math.random() * 0.4;
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
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
        opacity: 0.5,
        pointerEvents: "none",
      }}
      aria-hidden
    />
  );
}
