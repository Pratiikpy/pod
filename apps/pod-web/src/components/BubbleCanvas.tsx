'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { BubbleData } from '@/lib/bubble-data';
import { POD, scoreColor } from '@/design/tokens';

/**
 * Canvas-rendered POD Score bubbles.
 *  - Position: simple Verlet physics with center-pull + collision
 *  - Size: market-cap rank (rank 1 = largest)
 *  - Color: POD Score (lime → amber → red)
 *  - Pulse: |z|, the signal strength
 *  - Click: opens detail drawer
 */

interface BubbleNode extends BubbleData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Per-frame pulse phase 0..2π. */
  phase: number;
}

const SIZE_BY_RANK = [120, 96, 84, 76, 70, 64, 60, 56, 52, 48];
const SIZE_BY_RANK_NARROW = [80, 66, 60, 56, 52, 48, 44, 42, 40, 38];

function pickSizes(viewportWidth: number): number[] {
  return viewportWidth < 640 ? SIZE_BY_RANK_NARROW : SIZE_BY_RANK;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function BubbleCanvas({
  bubbles,
  onSelect,
}: {
  bubbles: BubbleData[];
  onSelect: (b: BubbleData) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const dprRef = useRef(1);

  // Build / re-build nodes when input data changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const sizes = pickSizes(w);
    nodesRef.current = bubbles.map((b, i) => {
      const r = sizes[Math.min(b.rank - 1, sizes.length - 1)] ?? 50;
      const angle = (i / bubbles.length) * Math.PI * 2;
      return {
        ...b,
        x: w / 2 + Math.cos(angle) * (Math.min(w, h) * 0.25),
        y: h / 2 + Math.sin(angle) * (Math.min(w, h) * 0.25),
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r,
        phase: Math.random() * Math.PI * 2,
      };
    });
  }, [bubbles]);

  // Resize canvas to its CSS size with HiDPI support.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Render + physics loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tick = () => {
      const dpr = dprRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const nodes = nodesRef.current;

      // Physics: gentle center pull + collision repulsion.
      for (const n of nodes) {
        const dx = cx - n.x;
        const dy = cy - n.y;
        n.vx += dx * 0.0006;
        n.vy += dy * 0.0006;
        n.vx *= 0.94;
        n.vy *= 0.94;
        n.x += n.vx;
        n.y += n.vy;
        // Edge bounce
        const margin = n.r + 8;
        if (n.x < margin) {
          n.x = margin;
          n.vx = Math.abs(n.vx) * 0.6;
        }
        if (n.x > w - margin) {
          n.x = w - margin;
          n.vx = -Math.abs(n.vx) * 0.6;
        }
        if (n.y < margin) {
          n.y = margin;
          n.vy = Math.abs(n.vy) * 0.6;
        }
        if (n.y > h - margin) {
          n.y = h - margin;
          n.vy = -Math.abs(n.vy) * 0.6;
        }
        n.phase += prefersReducedMotion() ? 0 : 0.03;
      }
      // Collision pass
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const min = a.r + b.r + 8;
          if (dist < min) {
            const overlap = (min - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;
            a.vx -= nx * 0.05;
            a.vy -= ny * 0.05;
            b.vx += nx * 0.05;
            b.vy += ny * 0.05;
          }
        }
      }

      // Render
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const n of nodes) {
        const c = scoreColor(n.score);
        const isHover = hovered === n.asset;
        // Pulse: |z| drives intensity oscillation
        const pulseAmp = Math.min(0.35, Math.abs(n.z) * 0.18);
        const glow = 0.4 + Math.sin(n.phase) * pulseAmp;

        // Outer glow
        const grad = ctx.createRadialGradient(n.x, n.y, n.r * 0.4, n.x, n.y, n.r * 1.6);
        grad.addColorStop(0, `${c}${alphaHex(0.35 + glow * 0.4)}`);
        grad.addColorStop(1, `${c}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 1.6, 0, Math.PI * 2);
        ctx.fill();

        // Body
        ctx.fillStyle = `${c}${alphaHex(0.14 + glow * 0.06)}`;
        ctx.strokeStyle = c;
        ctx.lineWidth = isHover ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Asset label (Geist sans, monogram-ish)
        ctx.fillStyle = POD.ink50;
        ctx.font = `600 ${Math.round(n.r * 0.32)}px Geist, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.asset, n.x, n.y - n.r * 0.08);

        // Score (Instrument Serif italic)
        ctx.fillStyle = c;
        ctx.font = `400 ${Math.round(n.r * 0.5)}px "Instrument Serif", serif`;
        ctx.textBaseline = 'middle';
        const scoreY = n.y + n.r * 0.32;
        ctx.fillText(`${n.score}`, n.x, scoreY);
      }

      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [hovered]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let found: string | null = null;
      for (const n of nodesRef.current) {
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy <= n.r * n.r) {
          found = n.asset;
          break;
        }
      }
      setHovered(found);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = found ? 'pointer' : 'default';
      }
    },
    [],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const n of nodesRef.current) {
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy <= n.r * n.r) {
          const { x: _x, y: _y, vx: _vx, vy: _vy, r: _r, phase: _phase, ...bubble } = n;
          onSelect(bubble);
          return;
        }
      }
    },
    [onSelect],
  );

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background:
          'radial-gradient(120% 70% at 50% 0%, rgba(207,255,61,0.05), transparent 55%)',
      }}
    />
  );
}

function alphaHex(a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  return v.toString(16).padStart(2, '0');
}
