"use client";

import { useEffect, useRef } from "react";

/**
 * Lightweight dithered noise background — pure 2D canvas.
 * Produces a cross-hatch/dot pattern that fades diagonally
 * (dense bottom-right, sparse top-left). No three.js.
 *
 * Respects prefers-reduced-motion (renders static frame only).
 */
export function DitherBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let animId = 0;
    let time = 0;

    // 8x8 Bayer matrix for ordered dithering
    const bayer = [
      0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4,
      52, 11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49,
      13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42,
      26, 38, 22, 41, 25, 37, 21,
    ];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Render at reduced resolution for performance
      const scale = 0.5;
      canvas!.width = Math.floor(canvas!.offsetWidth * dpr * scale);
      canvas!.height = Math.floor(canvas!.offsetHeight * dpr * scale);
    }

    // Simple 2D hash for pseudo-noise
    function hash(x: number, y: number, seed: number): number {
      const n = Math.sin(x * 127.1 + y * 311.7 + seed * 43758.5453) * 43758.5453;
      return n - Math.floor(n);
    }

    // Smooth noise with interpolation
    function noise(x: number, y: number, seed: number): number {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;

      // Smoothstep
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);

      const a = hash(ix, iy, seed);
      const b = hash(ix + 1, iy, seed);
      const c = hash(ix, iy + 1, seed);
      const d = hash(ix + 1, iy + 1, seed);

      return a + sx * (b - a) + sy * (c - a) + sx * sy * (a - b - c + d);
    }

    // Fractal brownian motion — 3 octaves
    function fbm(x: number, y: number, t: number): number {
      let value = 0;
      let amp = 1;
      let freq = 1;
      for (let i = 0; i < 3; i++) {
        value += amp * noise(x * freq + t * 0.3, y * freq + t * 0.2, i * 17.0);
        amp *= 0.5;
        freq *= 2.0;
      }
      return value;
    }

    function draw() {
      const w = canvas!.width;
      const h = canvas!.height;
      const imageData = ctx!.createImageData(w, h);
      const data = imageData.data;

      const PIXEL_SIZE = 2;
      const COLOR_LEVELS = 4;

      for (let y = 0; y < h; y += PIXEL_SIZE) {
        for (let x = 0; x < w; x += PIXEL_SIZE) {
          // Normalized coordinates
          const nx = x / w;
          const ny = y / h;

          // FBM noise value
          const n = fbm(nx * 3, ny * 3, time);

          // Diagonal fade: dense bottom-right, sparse top-left
          const fade = (nx * 0.6 + ny * 0.7) * 0.8;
          const intensity = n * fade;

          // Bayer dithering
          const bx = (x / PIXEL_SIZE) & 7;
          const by = (y / PIXEL_SIZE) & 7;
          const threshold = bayer[by * 8 + bx] / 64 - 0.25;
          const step = 1 / (COLOR_LEVELS - 1);

          let col = intensity + threshold * step;
          col = Math.max(col - 0.2, 0);
          col = Math.floor(col * (COLOR_LEVELS - 1) + 0.5) / (COLOR_LEVELS - 1);

          // Map to very dark RGB — subtle against #111 bg
          const r = Math.floor(col * 40);
          const g = Math.floor(col * 40);
          const b = Math.floor(col * 45);

          // Fill pixel block
          for (let py = 0; py < PIXEL_SIZE && y + py < h; py++) {
            for (let px = 0; px < PIXEL_SIZE && x + px < w; px++) {
              const idx = ((y + py) * w + (x + px)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = 255;
            }
          }
        }
      }

      ctx!.putImageData(imageData, 0, 0);

      if (!prefersReduced) {
        time += 0.008;
        animId = requestAnimationFrame(draw);
      }
    }

    resize();
    draw();

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 w-full h-full"
      style={{ zIndex: 0, imageRendering: "pixelated" }}
    />
  );
}
