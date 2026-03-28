"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../lib/socket";

/* ── constants ── */
const COLS = 20;
const ROWS = 20;
const TOTAL = COLS * ROWS;

/* ── types ── */
type Phase = "lobby" | "waiting" | "playing" | "gameover";
interface CellLocal {
  kind: "land" | "water" | "unknown";
  revealed: boolean;
  value: number;
  claimedBy: 1 | 2 | null;
}

function isWater(r: number, g: number, b: number) {
  return b > 120 && b > r + 35 && b > g;
}

/* ── water mask builder (runs once from image) ── */
function buildWaterMask(img: HTMLImageElement): boolean[] {
  const tmp = document.createElement("canvas");
  tmp.width = img.naturalWidth;
  tmp.height = img.naturalHeight;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const cw = img.naturalWidth / COLS;
  const ch = img.naturalHeight / ROWS;
  const mask: boolean[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = Math.round(c * cw + cw / 2);
      const cy = Math.round(r * ch + ch / 2);
      let w = 0, t = 0;
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dx = -4; dx <= 4; dx += 2) {
          const px = Math.min(Math.max(cx + dx, 0), img.naturalWidth - 1);
          const py = Math.min(Math.max(cy + dy, 0), img.naturalHeight - 1);
          const d = ctx.getImageData(px, py, 1, 1).data;
          if (isWater(d[0], d[1], d[2])) w++;
          t++;
        }
      }
      mask.push(w / t >= 0.45);
    }
  }
  return mask;
}

export default function HormuzMultiplayer() {
  /* ── refs ── */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const waterMaskRef = useRef<boolean[]>([]); // flat 400-length array

  /* ── state ── */
  const [phase, setPhase] = useState<Phase>("lobby");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mySlot, setMySlot] = useState<1 | 2 | null>(null);
  const [players, setPlayers] = useState<{ name: string; slot: number; score: number }[]>([]);
  const [currentTurn, setCurrentTurn] = useState<1 | 2>(1);
  const [scores, setScores] = useState<{ 1: number; 2: number }>({ 1: 0, 2: 0 });
  const [cells, setCells] = useState<CellLocal[]>([]);
  const [winner, setWinner] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [liveStats, setLiveStats] = useState<{ onlinePlayers: number; activeGames: number }>({ onlinePlayers: 0, activeGames: 0 });

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2500); };

  /* ── load image once ── */
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = "/straight.png";
    img.onload = () => {
      imgRef.current = img;
      const maxW = Math.min(900, window.innerWidth - 32);
      const scale = maxW / img.naturalWidth;
      setSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
      waterMaskRef.current = buildWaterMask(img);
      // Build initial blank cells from water mask
      setCells(waterMaskRef.current.map((w) => ({ kind: w ? "water" : "land", revealed: false, value: 0, claimedBy: null })));
      setImgLoaded(true);
    };
  }, []);

  /* ── socket listeners ── */
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.on("game_start", (data) => {
      setPlayers(data.players);
      setCurrentTurn(data.currentTurn);
      setScores({ 1: 0, 2: 0 });
      setPhase("playing");
      // Reset cells to unrevealed
      setCells(waterMaskRef.current.map((w) => ({ kind: w ? "water" : "land", revealed: false, value: 0, claimedBy: null })));
    });

    socket.on("cell_revealed", (data) => {
      setCells((prev) => prev.map((c, i) =>
        i === data.cellIndex
          ? { ...c, revealed: true, value: data.value, claimedBy: data.claimedBy }
          : c
      ));
      setScores(data.scores);
      setCurrentTurn(data.currentTurn);
    });

    socket.on("danger_hit", (data) => {
      setCells((prev) => prev.map((c, i) =>
        i === data.cellIndex
          ? { ...c, revealed: true, kind: "unknown", value: -1, claimedBy: data.hitBy }
          : c
      ));
      showFlash(`💥 ${data.playerName} hit a DANGER cell! Resetting...`);
    });

    socket.on("game_reset", (data) => {
      setPlayers(data.players);
      setCurrentTurn(data.currentTurn);
      setScores({ 1: 0, 2: 0 });
      setCells(waterMaskRef.current.map((w) => ({ kind: w ? "water" : "land", revealed: false, value: 0, claimedBy: null })));
    });

    socket.on("game_over", (data) => {
      setWinner(data.winner);
      setScores(data.scores);
      setPlayers(data.players);
      setPhase("gameover");
    });

    socket.on("player_disconnected", (data) => {
      showFlash(`${data.playerName} disconnected. You win!`);
      if (data.scores) setScores(data.scores);
      if (data.players) setPlayers(data.players);
      setWinner(data.winner ?? mySlot);
      setPhase("gameover");
    });

    socket.on("live_stats", (data) => {
      setLiveStats(data);
    });

    return () => {
      socket.off("game_start");
      socket.off("cell_revealed");
      socket.off("danger_hit");
      socket.off("game_reset");
      socket.off("game_over");
      socket.off("player_disconnected");
      socket.off("live_stats");
    };
  }, [mySlot]);

  /* ── actions ── */
  const handleCreate = useCallback(() => {
    if (!playerName.trim()) { setError("Enter your name"); return; }
    setError(null);
    const socket = getSocket();
    socket.emit("create_room", { playerName: playerName.trim(), waterMask: waterMaskRef.current }, (res: any) => {
      if (res.ok) {
        setRoomCode(res.roomCode);
        setMySlot(res.slot);
        setPhase("waiting");
      } else {
        setError(res.error);
      }
    });
  }, [playerName]);

  const handleJoin = useCallback(() => {
    if (!playerName.trim()) { setError("Enter your name"); return; }
    if (!joinCode.trim()) { setError("Enter room code"); return; }
    setError(null);
    const socket = getSocket();
    socket.emit("join_room", { roomCode: joinCode.trim().toUpperCase(), playerName: playerName.trim(), waterMask: waterMaskRef.current }, (res: any) => {
      if (res.ok) {
        setRoomCode(res.roomCode);
        setMySlot(res.slot);
      } else {
        setError(res.error);
      }
    });
  }, [playerName, joinCode]);

  const handleCopy = useCallback(() => {
    const link = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomCode]);

  /* ── canvas click ── */
  const cellFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (size.w / rect.width);
    const y = (e.clientY - rect.top) * (size.h / rect.height);
    const col = Math.floor(x / (size.w / COLS));
    const row = Math.floor(y / (size.h / ROWS));
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    return row * COLS + col;
  }, [size]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== "playing" || currentTurn !== mySlot) return;
    const idx = cellFromEvent(e);
    if (idx === null) return;
    const cell = cells[idx];
    if (!cell || cell.kind === "land" || cell.revealed) return;

    const socket = getSocket();
    socket.emit("cell_click", { roomCode, cellIndex: idx }, (res: any) => {
      if (!res.ok) console.warn("click rejected:", res.error);
    });
  }, [phase, currentTurn, mySlot, cells, roomCode, cellFromEvent]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== "playing") return;
    const idx = cellFromEvent(e);
    const canvas = canvasRef.current;
    if (idx === null) { setHover(null); if (canvas) canvas.style.cursor = "default"; return; }
    const cell = cells[idx];
    const clickable = cell && cell.kind !== "land" && !cell.revealed && currentTurn === mySlot;
    if (canvas) canvas.style.cursor = clickable ? "pointer" : "default";
    setHover(clickable ? idx : null);
  }, [phase, cells, currentTurn, mySlot, cellFromEvent]);

  /* ── draw canvas ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !size.w || !cells.length) return;
    const ctx = canvas.getContext("2d")!;
    const { w, h } = size;
    const cw = w / COLS;
    const ch = h / ROWS;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    for (let i = 0; i < TOTAL; i++) {
      const cell = cells[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * cw, y = row * ch;
      const hovered = hover === i;

      if (cell.kind === "land") {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 0.4;
        ctx.strokeRect(x, y, cw, ch);
        continue;
      }

      if (cell.revealed) {
        if (cell.value === -1) {
          // danger
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
      } else if (phase === "playing") {
        ctx.fillStyle = hovered ? "rgba(255,255,255,0.28)" : "rgba(30,100,200,0.13)";
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = hovered ? "rgba(200,240,255,0.75)" : "rgba(100,200,255,0.32)";
        ctx.lineWidth = hovered ? 1.2 : 0.7;
        ctx.strokeRect(x, y, cw, ch);
      }
    }
  }, [cells, size, phase, hover]);

  /* ── stats ── */
  const safeTotal = cells.filter((c) => c.kind === "water").length;
  const revealedSafe = cells.filter((c) => c.kind !== "land" && c.revealed && c.value !== -1).length;
  const progress = safeTotal > 0 ? Math.round((revealedSafe / safeTotal) * 100) : 0;
  const isMyTurn = currentTurn === mySlot;

  /* ── RENDER ── */
  return (
    <div className="min-h-screen bg-[#060a12] text-white flex flex-col items-center py-6 px-4 select-none" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Flash */}
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-400 ${flash ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"}`}>
        <div className="bg-red-950 border border-red-500 text-red-200 px-6 py-3 rounded-2xl shadow-2xl font-bold backdrop-blur-md text-sm">{flash}</div>
      </div>

      {/* Title */}
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-black tracking-widest uppercase bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 bg-clip-text text-transparent">
          Strait of Hormuz
        </h1>
        <p className="text-zinc-500 text-xs mt-1 tracking-widest">MULTIPLAYER · OPEN THE STRAIT · AVOID DANGER</p>
      </div>

      {/* ═══════ LOBBY ═══════ */}
      {phase === "lobby" && (
        <div className="bg-zinc-900/90 border border-zinc-700 rounded-3xl p-8 max-w-md w-full shadow-2xl mt-4">
          {/* Live Stats Bar */}
          <div className="flex justify-center gap-6 mb-6">
            <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-full px-4 py-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
              <span className="text-green-400 text-xs font-bold">{liveStats.onlinePlayers}</span>
              <span className="text-zinc-400 text-xs">Online</span>
            </div>
            <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-full px-4 py-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
              <span className="text-amber-400 text-xs font-bold">{liveStats.activeGames}</span>
              <span className="text-zinc-400 text-xs">Active Games</span>
            </div>
          </div>

          <div className="text-5xl mb-4 text-center">🌊</div>
          <h2 className="text-xl font-bold text-center mb-6">Join or Create a Game</h2>

          <label className="text-xs text-zinc-400 uppercase tracking-wider font-bold mb-1 block">Your Name</label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Captain..."
            maxLength={20}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-600 px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 mb-5"
          />

          <button onClick={handleCreate} disabled={!imgLoaded}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-transform cursor-pointer disabled:opacity-40 mb-3">
            🏠 Create Room
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-zinc-700" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-zinc-700" />
          </div>

          <label className="text-xs text-zinc-400 uppercase tracking-wider font-bold mb-1 block">Room Code</label>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="HZ-XXXX"
            maxLength={7}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-600 px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 mb-3 tracking-widest text-center font-mono text-lg"
          />
          <button onClick={handleJoin} disabled={!imgLoaded}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-500 to-fuchsia-600 text-white font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-transform cursor-pointer disabled:opacity-40">
            🎮 Join Room
          </button>

          {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}
        </div>
      )}

      {/* ═══════ WAITING FOR PLAYER 2 ═══════ */}
      {phase === "waiting" && (
        <div className="bg-zinc-900/90 border border-zinc-700 rounded-3xl p-8 max-w-md w-full shadow-2xl mt-4 text-center">
          <div className="w-10 h-10 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Waiting for opponent...</h2>
          <p className="text-zinc-400 text-sm mb-5">Share this room code with your friend:</p>

          <div className="bg-zinc-800 border border-zinc-600 rounded-2xl px-6 py-4 mb-4">
            <p className="text-3xl font-black tracking-[0.3em] text-cyan-400 font-mono">{roomCode}</p>
          </div>

          <button onClick={handleCopy}
            className="px-6 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-white font-semibold text-sm transition-colors cursor-pointer">
            {copied ? "✅ Copied!" : "📋 Copy Invite Link"}
          </button>
        </div>
      )}

      {/* ═══════ PLAYING / GAME OVER ═══════ */}
      {(phase === "playing" || phase === "gameover") && (
        <>
          {/* Scoreboards */}
          <div className="flex gap-4 mb-4 w-full" style={{ maxWidth: size.w || 900 }}>
            {([1, 2] as const).map((slot) => {
              const p = players.find((pl) => pl.slot === slot);
              const active = currentTurn === slot && phase === "playing";
              const isMe = mySlot === slot;
              const cyan = slot === 1;
              return (
                <div key={slot} className={`flex-1 rounded-2xl border p-3 bg-gray-900/80 transition-all duration-300
                  ${cyan ? "border-cyan-600" : "border-fuchsia-600"}
                  ${active ? `ring-2 shadow-lg ${cyan ? "ring-cyan-500 shadow-cyan-500/30" : "ring-fuchsia-500 shadow-fuchsia-500/30"}` : "opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-[10px] tracking-widest uppercase font-bold ${cyan ? "text-cyan-400" : "text-fuchsia-400"}`}>
                        {p?.name || `Player ${slot}`} {isMe && <span className="text-zinc-500">(You)</span>}
                      </p>
                      <p className="text-3xl font-black mt-0.5">{scores[slot]}</p>
                    </div>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-base ${cyan ? "bg-cyan-500" : "bg-fuchsia-500"}`}>{slot}</div>
                  </div>
                  {active && (
                    <p className={`text-[10px] mt-1.5 font-semibold flex items-center gap-1 ${cyan ? "text-cyan-400" : "text-fuchsia-400"}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse inline-block" />
                      {isMe ? "Your Turn" : "Their Turn"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Turn indicator */}
          {phase === "playing" && (
            <div className={`mb-3 text-sm font-bold px-4 py-1.5 rounded-full ${isMyTurn ? "bg-green-900/50 text-green-400 border border-green-600" : "bg-zinc-800 text-zinc-400 border border-zinc-600"}`}>
              {isMyTurn ? "🟢 Your Turn — Click a water cell!" : "⏳ Waiting for opponent..."}
            </div>
          )}

          {/* Progress */}
          {phase === "playing" && (
            <div className="w-full mb-3" style={{ maxWidth: size.w || 900 }}>
              <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                <span>Strait Opening Progress</span>
                <span>{revealedSafe}/{safeTotal} cells ({progress}%)</span>
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Canvas */}
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/40 border border-zinc-700/60" style={{ width: size.w || "auto" }}>
            {size.w > 0 && (
              <canvas ref={canvasRef} width={size.w} height={size.h}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHover(null)}
                className="block" />
            )}

            {/* Game over overlay */}
            {phase === "gameover" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                <div className="bg-zinc-900/95 border border-zinc-600 rounded-3xl p-8 max-w-xs w-full text-center shadow-2xl">
                  <div className="text-5xl mb-3">{winner === 0 ? "🤝" : winner === mySlot ? "🏆" : "😢"}</div>
                  <h2 className="text-xl font-bold mb-3">
                    {winner === 0 ? "It's a Tie!" : winner === mySlot ? "You Win!" : "You Lost!"}
                  </h2>
                  <div className="flex gap-3 justify-center mb-5">
                    <div className="bg-cyan-900/40 border border-cyan-700 rounded-xl px-4 py-2">
                      <p className="text-cyan-400 text-[10px] font-bold uppercase">{players.find((p) => p.slot === 1)?.name}</p>
                      <p className="text-2xl font-black">{scores[1]}</p>
                    </div>
                    <div className="bg-fuchsia-900/40 border border-fuchsia-700 rounded-xl px-4 py-2">
                      <p className="text-fuchsia-400 text-[10px] font-bold uppercase">{players.find((p) => p.slot === 2)?.name}</p>
                      <p className="text-2xl font-black">{scores[2]}</p>
                    </div>
                  </div>
                  <button onClick={() => { setPhase("lobby"); setRoomCode(""); setJoinCode(""); setWinner(null); }}
                    className="px-8 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer">
                    Back to Lobby
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
        </>
      )}
    </div>
  );
}
