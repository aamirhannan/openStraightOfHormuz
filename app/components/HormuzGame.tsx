"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const COLS = 20;
const ROWS = 20;
const DANGER_RATIO = 0.12;

type CellKind = "land" | "water" | "danger";
interface Cell { kind: CellKind; revealed: boolean; value: number; claimedBy: 1 | 2 | null; }
type GameStatus = "idle" | "playing" | "gameover";

function isWater(r: number, g: number, b: number) {
  return b > 120 && b > r + 35 && b > g;
}

function buildCells(waterMap: boolean[][]): Cell[][] {
  const waterPos: [number, number][] = [];
  const grid: Cell[][] = Array.from({ length: ROWS }, (_, ri) =>
    Array.from({ length: COLS }, (_, ci) => {
      const w = waterMap[ri][ci];
      if (w) waterPos.push([ri, ci]);
      return { kind: w ? "water" : "land", revealed: false, value: Math.floor(Math.random() * 10), claimedBy: null };
    })
  );
  const shuffled = [...waterPos].sort(() => Math.random() - 0.5);
  shuffled.slice(0, Math.floor(waterPos.length * DANGER_RATIO)).forEach(([r, c]) => {
    grid[r][c].kind = "danger";
  });
  return grid;
}

export default function HormuzGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const waterMapRef = useRef<boolean[][] | null>(null);

  const [cells, setCells] = useState<Cell[][]>([]);
  const [player, setPlayer] = useState<1 | 2>(1);
  const [scores, setScores] = useState<{ 1: number; 2: number }>({ 1: 0, 2: 0 });
  const [status, setStatus] = useState<GameStatus>("idle");
  const [winner, setWinner] = useState<1 | 2 | "tie" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [resetting, setResetting] = useState(false);

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2500); };

  // Load image + detect water cells
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = "/straight.png";
    img.onload = () => {
      imgRef.current = img;
      const maxW = Math.min(900, window.innerWidth - 32);
      const scale = maxW / img.naturalWidth;
      setSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });

      // Offscreen canvas for pixel sampling
      const tmp = document.createElement("canvas");
      tmp.width = img.naturalWidth;
      tmp.height = img.naturalHeight;
      const tCtx = tmp.getContext("2d")!;
      tCtx.drawImage(img, 0, 0);

      const cw = img.naturalWidth / COLS;
      const ch = img.naturalHeight / ROWS;
      const wm: boolean[][] = [];

      for (let r = 0; r < ROWS; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < COLS; c++) {
          const cx = Math.round(c * cw + cw / 2);
          const cy = Math.round(r * ch + ch / 2);
          let w = 0, t = 0;
          // Sample 5x5 area at cell center
          for (let dy = -4; dy <= 4; dy += 2) {
            for (let dx = -4; dx <= 4; dx += 2) {
              const px = Math.min(Math.max(cx + dx, 0), img.naturalWidth - 1);
              const py = Math.min(Math.max(cy + dy, 0), img.naturalHeight - 1);
              const d = tCtx.getImageData(px, py, 1, 1).data;
              if (isWater(d[0], d[1], d[2])) w++;
              t++;
            }
          }
          row.push(w / t >= 0.45);
        }
        wm.push(row);
      }
      waterMapRef.current = wm;
      setLoaded(true);
    };
  }, []);

  // Danger reset timer
  useEffect(() => {
    if (!resetting || !waterMapRef.current) return;
    const t = setTimeout(() => {
      setCells(buildCells(waterMapRef.current!));
      setPlayer(1);
      setScores({ 1: 0, 2: 0 });
      setStatus("playing");
      setResetting(false);
    }, 1800);
    return () => clearTimeout(t);
  }, [resetting]);

  const startGame = useCallback(() => {
    if (!waterMapRef.current) return;
    setCells(buildCells(waterMapRef.current));
    setPlayer(1);
    setScores({ 1: 0, 2: 0 });
    setStatus("playing");
    setWinner(null);
    setHover(null);
    setResetting(false);
  }, []);

  // Game-over check
  useEffect(() => {
    if (status !== "playing" || !cells.length) return;
    const done = cells.every((row) => row.every((c) => c.kind === "land" || c.revealed));
    if (done) {
      setStatus("gameover");
      setWinner(scores[1] > scores[2] ? 1 : scores[2] > scores[1] ? 2 : "tie");
    }
  }, [cells, status, scores]);

  // DRAW canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !size.w) return;
    const ctx = canvas.getContext("2d")!;
    const { w, h } = size;
    const cw = w / COLS;
    const ch = h / ROWS;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    if (!cells.length) return;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = cells[r][c];
        const x = c * cw, y = r * ch;
        const hovered = hover?.[0] === r && hover?.[1] === c;

        if (cell.kind === "land") {
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = "rgba(0,0,0,0.12)";
          ctx.lineWidth = 0.4;
          ctx.strokeRect(x, y, cw, ch);
          continue;
        }

        if (cell.revealed) {
          if (cell.kind === "danger") {
            ctx.fillStyle = "rgba(220,38,38,0.88)";
            ctx.fillRect(x, y, cw, ch);
            ctx.strokeStyle = "rgba(255,80,80,1)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, cw, ch);
            ctx.fillStyle = "#fff";
            ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.55)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⚠", x + cw / 2, y + ch / 2);
          } else {
            ctx.fillStyle = cell.claimedBy === 1 ? "rgba(6,182,212,0.75)" : "rgba(217,70,239,0.75)";
            ctx.fillRect(x, y, cw, ch);
            ctx.strokeStyle = cell.claimedBy === 1 ? "rgba(6,182,212,1)" : "rgba(217,70,239,1)";
            ctx.lineWidth = 1.2;
            ctx.strokeRect(x, y, cw, ch);
            ctx.fillStyle = "#fff";
            ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.55)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(cell.value), x + cw / 2, y + ch / 2);
          }
        } else if (status === "playing") {
          ctx.fillStyle = hovered ? "rgba(255,255,255,0.28)" : "rgba(30,100,200,0.13)";
          ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = hovered ? "rgba(200,240,255,0.75)" : "rgba(100,200,255,0.32)";
          ctx.lineWidth = hovered ? 1.2 : 0.7;
          ctx.strokeRect(x, y, cw, ch);
        }
      }
    }
  }, [cells, size, status, hover]);

  const cellFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (size.w / rect.width);
    const y = (e.clientY - rect.top) * (size.h / rect.height);
    const col = Math.floor(x / (size.w / COLS));
    const row = Math.floor(y / (size.h / ROWS));
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return [row, col];
  }, [size]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== "playing") return;
    const pos = cellFromEvent(e);
    const canvas = canvasRef.current;
    if (!pos) { setHover(null); if (canvas) canvas.style.cursor = "default"; return; }
    const [r, c] = pos;
    const cell = cells[r]?.[c];
    const clickable = cell && cell.kind !== "land" && !cell.revealed;
    if (canvas) canvas.style.cursor = clickable ? "pointer" : "default";
    setHover(clickable ? [r, c] : null);
  }, [status, cells, cellFromEvent]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== "playing" || resetting) return;
    const pos = cellFromEvent(e);
    if (!pos) return;
    const [row, col] = pos;
    const cell = cells[row]?.[col];
    if (!cell || cell.kind === "land" || cell.revealed) return;

    if (cell.kind === "danger") {
      setCells((prev) => prev.map((r, ri) => r.map((c, ci) => ri === row && ci === col ? { ...c, revealed: true } : c)));
      showFlash(`💥 Player ${player} hit a DANGER cell! Resetting...`);
      setResetting(true);
      setHover(null);
      return;
    }

    const gained = cell.value;
    setCells((prev) => prev.map((r, ri) => r.map((c, ci) => ri === row && ci === col ? { ...c, revealed: true, claimedBy: player } : c)));
    setScores((prev) => ({ ...prev, [player]: prev[player] + gained }));
    setPlayer((prev) => (prev === 1 ? 2 : 1));
  }, [status, resetting, cells, player, cellFromEvent]);

  // Stats
  const allCells = cells.flat();
  const safeTotal = allCells.filter((c) => c.kind === "water").length;
  const revealed = allCells.filter((c) => c.kind !== "land" && c.revealed && c.kind !== "danger").length;
  const progress = safeTotal > 0 ? Math.round((revealed / safeTotal) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#060a12] text-white flex flex-col items-center py-6 px-4 select-none" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Flash */}
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-400 ${flash ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"}`}>
        <div className="bg-red-950 border border-red-500 text-red-200 px-6 py-3 rounded-2xl shadow-2xl font-bold backdrop-blur-md text-sm">
          {flash}
        </div>
      </div>

      {/* Title */}
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-black tracking-widest uppercase bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 bg-clip-text text-transparent">
          Strait of Hormuz
        </h1>
        <p className="text-zinc-500 text-xs mt-1 tracking-widest">2-PLAYER · OPEN THE STRAIT · AVOID DANGER</p>
      </div>

      {/* Scoreboards */}
      <div className="flex gap-4 mb-4 w-full" style={{ maxWidth: size.w || 900 }}>
        {([1, 2] as const).map((p) => {
          const active = player === p && status === "playing";
          const cyan = p === 1;
          return (
            <div key={p} className={`flex-1 rounded-2xl border p-3 bg-gray-900/80 transition-all duration-300
              ${cyan ? "border-cyan-600" : "border-fuchsia-600"}
              ${active ? `ring-2 shadow-lg ${cyan ? "ring-cyan-500 shadow-cyan-500/30" : "ring-fuchsia-500 shadow-fuchsia-500/30"}` : "opacity-60"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-[10px] tracking-widest uppercase font-bold ${cyan ? "text-cyan-400" : "text-fuchsia-400"}`}>Player {p}</p>
                  <p className="text-3xl font-black mt-0.5">{scores[p]}</p>
                </div>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-base ${cyan ? "bg-cyan-500" : "bg-fuchsia-500"}`}>{p}</div>
              </div>
              {active && (
                <p className={`text-[10px] mt-1.5 font-semibold flex items-center gap-1 ${cyan ? "text-cyan-400" : "text-fuchsia-400"}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse inline-block" /> Your Turn
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress */}
      {status === "playing" && (
        <div className="w-full mb-3" style={{ maxWidth: size.w || 900 }}>
          <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
            <span>Strait Opening Progress</span>
            <span>{revealed}/{safeTotal} cells ({progress}%)</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/40 border border-zinc-700/60"
        style={{ width: size.w || "auto" }}>
        {size.w > 0 && (
          <canvas
            ref={canvasRef}
            width={size.w}
            height={size.h}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => { setHover(null); }}
            className="block"
          />
        )}

        {/* Loader */}
        {!loaded && (
          <div className="flex items-center justify-center w-full h-48 gap-3 text-zinc-400">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            Analyzing satellite imagery...
          </div>
        )}

        {/* Overlay: idle / gameover */}
        {status !== "playing" && loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="bg-zinc-900/95 border border-zinc-600 rounded-3xl p-8 max-w-xs w-full text-center shadow-2xl">
              {status === "idle" && (
                <>
                  <div className="text-5xl mb-3">🌊</div>
                  <h2 className="text-xl font-bold mb-2">Open the Strait?</h2>
                  <p className="text-zinc-400 text-xs mb-5 leading-5">
                    Take turns clicking water cells to earn points.<br />
                    Hit a <span className="text-red-400 font-bold">⚠ Danger</span> cell and the game resets!<br />
                    Most points when the strait opens — wins.
                  </p>
                </>
              )}
              {status === "gameover" && (
                <>
                  <div className="text-5xl mb-3">{winner === "tie" ? "🤝" : "🏆"}</div>
                  <h2 className="text-xl font-bold mb-3">{winner === "tie" ? "It's a Tie!" : `Player ${winner} Wins!`}</h2>
                  <div className="flex gap-3 justify-center mb-5">
                    <div className="bg-cyan-900/40 border border-cyan-700 rounded-xl px-4 py-2">
                      <p className="text-cyan-400 text-[10px] font-bold uppercase">P1</p>
                      <p className="text-2xl font-black">{scores[1]}</p>
                    </div>
                    <div className="bg-fuchsia-900/40 border border-fuchsia-700 rounded-xl px-4 py-2">
                      <p className="text-fuchsia-400 text-[10px] font-bold uppercase">P2</p>
                      <p className="text-2xl font-black">{scores[2]}</p>
                    </div>
                  </div>
                </>
              )}
              <button onClick={startGame} disabled={!loaded}
                className="px-8 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer disabled:opacity-40">
                {status === "idle" ? "Start Game" : "Play Again"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-5 mt-4 text-[11px] text-zinc-500 justify-center">
        {[
          { bg: "bg-cyan-600/60 border-cyan-500", label: "Player 1" },
          { bg: "bg-fuchsia-600/60 border-fuchsia-500", label: "Player 2" },
          { bg: "bg-red-900/60 border-red-500", label: "⚠ Danger (resets)" },
          { bg: "bg-blue-600/20 border-blue-400/40", label: "Water (clickable)" },
          { bg: "bg-black/30 border-black/20", label: "Land (locked)" },
        ].map(({ bg, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`w-3.5 h-3.5 rounded border inline-block ${bg}`} />{label}
          </span>
        ))}
      </div>
    </div>
  );
}
