"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "../lib/socket";
import { getUserId } from "../lib/userId";

/* ── constants ── */
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "https://openstraightofhormuz-backend.fly.dev";
const API_URL = `${SERVER_URL}/api`;

const COLS = 20;
const ROWS = 20;
const TOTAL = COLS * ROWS;

/* ── types ── */
type Phase = "lobby" | "placing" | "waiting_flipper" | "flipping" | "spectating" | "gameover";

interface CellLocal {
  kind: "land" | "water";
  revealed: boolean;
  value: number; // 0-9 for points, -1 for mine
  isMine?: boolean;
}

function isWater(r: number, g: number, b: number) {
  return b > 120 && b > r + 35 && b > g;
}

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
  const waterMaskRef = useRef<boolean[]>([]);

  /* ── state ── */
  const [userId, setUserId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("lobby");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreator, setIsCreator] = useState(false);

  // Game stats
  const [maxMines, setMaxMines] = useState(0);
  const [placedMines, setPlacedMines] = useState<Set<number>>(new Set());
  const [antidotes, setAntidotes] = useState(5);
  const [score, setScore] = useState(0);
  const [minesHit, setMinesHit] = useState(0);
  const [safeCells, setSafeCells] = useState(0);
  const [safeRevealed, setSafeRevealed] = useState(0);
  const [outcome, setOutcome] = useState<"won" | "lost" | null>(null);

  // Names
  const [creatorName, setCreatorName] = useState("");
  const [flipperName, setFlipperName] = useState("");

  const [cells, setCells] = useState<CellLocal[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [liveStats, setLiveStats] = useState<{ onlinePlayers: number; activeFlippers: number }>({ onlinePlayers: 0, activeFlippers: 0 });

  const showFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2500); };

  /* ── init ── */
  useEffect(() => {
    setUserId(getUserId());

    // Auto-fill from URL
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const roomFromUrl = searchParams.get("room");
      if (roomFromUrl) {
        setJoinCode(roomFromUrl.toUpperCase());
        setPlayerName("Player 2");
      }
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = "/straight.png";
    img.onload = () => {
      imgRef.current = img;
      const maxW = Math.min(900, window.innerWidth - 32);
      const scale = maxW / img.naturalWidth;
      setSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
      waterMaskRef.current = buildWaterMask(img);
      setCells(waterMaskRef.current.map((w) => ({ kind: w ? "water" : "land", revealed: false, value: 0 })));
      setImgLoaded(true);
    };
  }, []);

  /* ── socket ── */
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.on("live_stats", (data) => setLiveStats(data));

    socket.on("mines_confirmed", (data) => {
      if (data.roomCode === roomCode && !isCreator) {
        // Just in case watcher gets it
      } else if (data.roomCode === roomCode && isCreator && phase === "placing") {
        setPhase("waiting_flipper");
      }
    });

    socket.on("flip_update", (data) => {
      setCells((prev) => {
        const newCells = [...prev];
        newCells[data.cellIndex] = { ...newCells[data.cellIndex], revealed: true, value: data.value, isMine: data.isMine };
        return newCells;
      });
      setAntidotes(data.antidotes);
      setScore(data.score);
      setMinesHit(data.minesHit);
      setSafeRevealed(data.safeRevealed);

      if (isCreator) {
        if (data.isMine) {
          showFlash(`💥 Flipper hit your mine! (${data.antidotes} left)`);
        } else {
          showFlash(`🔍 Flipper found a safe spot! (+${data.value})`);
        }
      }

      if (data.outcome) {
        setPhase("gameover");
        setOutcome(data.outcome);
      }
    });

    socket.on("flipper_joined", (data) => {
      if (isCreator && phase === "waiting_flipper") {
        setPhase("spectating");
        setFlipperName(data.flipperName);
        showFlash(`🎮 ${data.flipperName} has joined and is flipping!`);
      }
    });

    socket.on("game_result", (data) => {
      setPhase("gameover");
      setOutcome(data.outcome);
    });

    return () => {
      socket.off("live_stats");
      socket.off("mines_confirmed");
      socket.off("flip_update");
      socket.off("game_result");
      socket.off("flipper_joined");
    };
  }, [roomCode, isCreator, phase]);

  useEffect(() => {
    if (roomCode) {
      getSocket().emit("watch_room", { roomCode });
    }
  }, [roomCode]);

  /* ── helper to rebuild cells array ── */
  const rebuildCells = (mask: boolean[], revealedVals: any[], myMines?: number[]) => {
    const newCells: CellLocal[] = mask.map((w) => ({ kind: w ? "water" : "land", revealed: false, value: 0 }));
    if (myMines) {
      myMines.forEach(idx => {
        newCells[idx].isMine = true;
      });
    }
    revealedVals?.forEach((rv: any) => {
      newCells[rv.idx].revealed = true;
      newCells[rv.idx].value = rv.value;
      newCells[rv.idx].isMine = rv.isMine;
    });
    setCells(newCells);
  };

  /* ── actions ── */
  const handleCreate = async () => {
    if (!playerName.trim()) { setError("Enter your name"); return; }
    setError(null);
    try {
      const res = await fetch(`${API_URL}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, playerName: playerName.trim(), waterMask: waterMaskRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setRoomCode(data.roomCode);
      setMaxMines(data.maxMines);
      setIsCreator(true);
      setCreatorName(playerName.trim());
      setPlacedMines(new Set());
      rebuildCells(waterMaskRef.current, []);
      setPhase("placing");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePlayBot = async () => {
    if (!playerName.trim()) { setError("Enter your name"); return; }
    setError(null);
    try {
      const res = await fetch(`${API_URL}/rooms/bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, playerName: playerName.trim(), waterMask: waterMaskRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setRoomCode(data.roomCode);
      setIsCreator(false);
      setCreatorName(data.creatorName);
      setFlipperName(playerName.trim());
      setMaxMines(data.totalMines);
      setAntidotes(data.antidotes);
      setScore(data.score);
      setMinesHit(data.minesHit);
      setSafeCells(data.safeCells || 0);

      rebuildCells(data.waterMask, []);
      setPhase("flipping");
      getSocket().emit("start_flipping");
      getSocket().emit("flipper_joined", { roomCode: data.roomCode, flipperName: playerName.trim() });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleResumeOrJoin = async () => {
    if (!playerName.trim()) { setError("Enter your name"); return; }
    if (!joinCode.trim()) { setError("Enter room code"); return; }
    setError(null);
    const code = joinCode.trim().toUpperCase();

    try {
      // 1. Try to get state
      let res = await fetch(`${API_URL}/rooms/${code}?userId=${userId}`);
      let data = await res.json();

      if (res.ok) {
        if (data.isCreator) {
          // Resume creator
          setRoomCode(data.roomCode);
          setIsCreator(true);
          setCreatorName(data.creatorName);
          setFlipperName(data.flipperName);
          setMaxMines(data.maxMines);
          setAntidotes(data.antidotes);
          setScore(data.score);
          setMinesHit(data.minesHit);
          setSafeCells(data.safeCells || 0);

          rebuildCells(data.waterMask, data.revealedValues || [], data.minePositions);
          if (data.status === "placing_mines") setPhase("placing");
          else if (data.status === "ready") setPhase("waiting_flipper");
          else if (data.status === "flipping") setPhase("spectating");
          else {
            setPhase("gameover");
            setOutcome(data.status); // won or lost
          }
          return;
        } else if (data.isFlipper) {
          // Resume flipper
          setRoomCode(data.roomCode);
          setIsCreator(false);
          setCreatorName(data.creatorName);
          setFlipperName(data.flipperName);
          setAntidotes(data.antidotes);
          setScore(data.score);
          setMinesHit(data.minesHit);
          setSafeCells(data.safeCells || 0);

          rebuildCells(data.waterMask, data.revealedValues || []);
          if (data.status === "flipping") {
            setPhase("flipping");
            getSocket().emit("start_flipping");
          } else {
            setPhase("gameover");
            setOutcome(data.status);
          }
          return;
        }
      }

      // 2. Not a returning player, try to join as flipper
      const joinRes = await fetch(`${API_URL}/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, playerName: playerName.trim() }),
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) throw new Error(joinData.error || "Failed to join");

      setRoomCode(joinData.roomCode);
      setIsCreator(false);
      setCreatorName(joinData.creatorName);
      setFlipperName(playerName.trim());
      setAntidotes(joinData.antidotes);
      setScore(joinData.score);
      setMinesHit(joinData.minesHit);
      setSafeCells(joinData.safeCells || 0);

      rebuildCells(joinData.waterMask, joinData.revealedValues || []);
      setPhase("flipping");
      getSocket().emit("start_flipping");
      getSocket().emit("flipper_joined", { roomCode: joinData.roomCode, flipperName: playerName.trim() });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const submitMines = async () => {
    try {
      const res = await fetch(`${API_URL}/rooms/${roomCode}/mines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, minePositions: Array.from(placedMines) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      getSocket().emit("mines_placed", { roomCode });
      setPhase("waiting_flipper");
    } catch (e: any) {
      showFlash(e.message);
    }
  };

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

  const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = cellFromEvent(e);
    if (idx === null) return;
    const cell = cells[idx];

    if (phase === "placing") {
      if (cell.kind === "land") return;
      setPlacedMines(prev => {
        const next = new Set(prev);
        if (next.has(idx)) {
          next.delete(idx);
        } else {
          // Check 8-way orthogonal and diagonal constraints
          const r = Math.floor(idx / COLS);
          const c = idx % COLS;
          const adjacent: number[] = [];
          for (const dr of [-1, 0, 1]) {
            for (const dc of [-1, 0, 1]) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                adjacent.push(nr * COLS + nc);
              }
            }
          }

          if (adjacent.some(a => next.has(a))) {
            showFlash("Mines cannot be placed directly adjacent to each other!");
            return prev;
          }

          if (next.size < maxMines) next.add(idx);
          else showFlash(`Max ${maxMines} mines allowed`);
        }
        return next;
      });
      return;
    }

    if (phase === "flipping") {
      if (!cell || cell.kind === "land" || cell.revealed) return;
      try {
        const res = await fetch(`${API_URL}/rooms/${roomCode}/flip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, cellIndex: idx }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Update locally
        setCells((prev) => {
          const newCells = [...prev];
          newCells[idx] = { ...newCells[idx], revealed: true, value: data.value, isMine: data.isMine };
          return newCells;
        });
        setAntidotes(data.antidotes);
        setScore(data.score);
        setMinesHit(data.minesHit);
        setSafeRevealed(data.safeRevealed);

        getSocket().emit("cell_flipped", { roomCode, cellIndex: idx, result: data });

        if (data.isMine) {
          showFlash(`💥 You hit a mine! ${data.antidotes} antidotes left.`);
        }

        if (data.outcome) {
          setPhase("gameover");
          setOutcome(data.outcome);
          getSocket().emit("game_ended", { roomCode, outcome: data.outcome });
        }
      } catch (e: any) {
        console.warn(e.message);
      }
    }
  };

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = cellFromEvent(e);
    const canvas = canvasRef.current;
    if (idx === null) { setHover(null); if (canvas) canvas.style.cursor = "default"; return; }
    const cell = cells[idx];

    let clickable = false;
    if (phase === "placing" && cell.kind === "water") clickable = true;
    else if (phase === "flipping" && cell && cell.kind === "water" && !cell.revealed) clickable = true;

    if (canvas) canvas.style.cursor = clickable ? "pointer" : "default";
    setHover(clickable ? idx : null);
  }, [phase, cells, cellFromEvent]);

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

      // Drawing logic for Placing phase
      if (phase === "placing" || phase === "waiting_flipper") {
        const hasMine = placedMines.has(i) || cell.isMine;
        if (hasMine) {
          ctx.fillStyle = "rgba(220,38,38,0.85)";
          ctx.fillRect(x, y, cw, ch);
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.55)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("💣", x + cw / 2, y + ch / 2);
        } else if (hovered && phase === "placing") {
          ctx.fillStyle = "rgba(255,255,255,0.28)";
          ctx.fillRect(x, y, cw, ch);
        }
        ctx.strokeStyle = "rgba(100,200,255,0.2)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cw, ch);
        continue;
      }

      // Drawing logic for Flipping / Spectating / Gameover
      if (cell.revealed || (phase === "gameover" && cell.isMine)) {
        if (cell.isMine) {
          ctx.fillStyle = "rgba(220,38,38,0.88)";
          ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = "rgba(255,80,80,1)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, cw, ch);
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.5)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("💥", x + cw / 2, y + ch / 2);
        } else {
          ctx.fillStyle = "rgba(6,182,212,0.75)";
          ctx.fillRect(x, y, cw, ch);
          ctx.strokeStyle = "rgba(6,182,212,1)";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x, y, cw, ch);
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.6)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(cell.value), x + cw / 2, y + ch / 2);
        }
      } else if (phase === "flipping" || phase === "spectating") {
        const hasMine = isCreator && (cell.isMine || placedMines.has(i));

        if (hasMine) {
          // Creator sees their unrevealed mines solidly so they don't disappear
          ctx.fillStyle = "rgba(220,38,38,0.85)";
          ctx.fillRect(x, y, cw, ch);
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.floor(Math.min(cw, ch) * 0.55)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("💣", x + cw / 2, y + ch / 2);
        } else {
          ctx.fillStyle = hovered && phase === "flipping" ? "rgba(255,255,255,0.28)" : "rgba(30,100,200,0.13)";
          ctx.fillRect(x, y, cw, ch);
        }

        ctx.strokeStyle = hovered && phase === "flipping" ? "rgba(200,240,255,0.75)" : "rgba(100,200,255,0.32)";
        ctx.lineWidth = hovered && phase === "flipping" ? 1.2 : 0.7;
        ctx.strokeRect(x, y, cw, ch);
      }
    }
  }, [cells, size, phase, hover, placedMines, isCreator]);

  /* ── RENDER ── */
  const progress = safeCells > 0 ? Math.round((safeRevealed / safeCells) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#060a12] text-white flex flex-col items-center py-6 px-4 select-none" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Flash */}
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-400 ${flash ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"}`}>
        <div className="bg-amber-950 border border-amber-500 text-amber-200 px-6 py-3 rounded-2xl shadow-2xl font-bold backdrop-blur-md text-sm">{flash}</div>
      </div>

      {/* Title */}
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-black tracking-widest uppercase bg-gradient-to-r from-cyan-400 via-white to-amber-400 bg-clip-text text-transparent">
          Strait of Hormuz
        </h1>
        <p className="text-zinc-500 text-xs mt-1 tracking-widest">MINE LAYER VS FLIPPER</p>
      </div>

      {/* ═══════ LOBBY ═══════ */}
      {phase === "lobby" && (
        <div className="bg-zinc-900/90 border border-zinc-700 rounded-3xl p-8 max-w-md w-full shadow-2xl mt-4">
          <div className="flex justify-center gap-6 mb-6">
            <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-full px-4 py-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
              <span className="text-green-400 text-xs font-bold">{liveStats.onlinePlayers}</span>
              <span className="text-zinc-400 text-xs">Online</span>
            </div>
            <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-full px-4 py-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
              <span className="text-amber-400 text-xs font-bold">{liveStats.activeFlippers}</span>
              <span className="text-zinc-400 text-xs">Flipping Now</span>
            </div>
          </div>

          <div className="text-5xl mb-4 text-center">💣 / 🔍</div>
          <h2 className="text-xl font-bold text-center mb-6">Layer or Flipper?</h2>

          <label className="text-xs text-zinc-400 uppercase tracking-wider font-bold mb-1 block">Your Name</label>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Name..."
            maxLength={20}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-600 px-4 py-3 text-white placeholder:text-zinc-500 mb-5"
          />

          <button onClick={handleCreate} disabled={!imgLoaded}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 font-bold mb-3 hover:scale-[1.02] transition-transform">
            🏠 Create Room (Layer)
          </button>

          <button onClick={handlePlayBot} disabled={!imgLoaded}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 font-bold mb-3 shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:scale-[1.02] transition-transform">
            🤖 Play vs AI Layer
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-zinc-700" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">or resume/join</span>
            <div className="flex-1 h-px bg-zinc-700" />
          </div>

          <label className="text-xs text-zinc-400 uppercase tracking-wider font-bold mb-1 block">Room Code</label>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="HZ-XXXX"
            maxLength={7}
            className="w-full rounded-xl bg-zinc-800 border border-zinc-600 px-4 py-3 text-white placeholder:text-zinc-500 mb-3 text-center tracking-widest font-mono"
          />
          <button onClick={handleResumeOrJoin} disabled={!imgLoaded}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 font-bold hover:scale-[1.02] transition-transform">
            🎮 Join/Resume Game
          </button>

          {error && <p className="text-red-400 text-sm mt-4 text-center">{error}</p>}
        </div>
      )}

      {/* ═══════ HEADER INFO (In Game) ═══════ */}
      {phase !== "lobby" && (
        <div className="flex gap-4 mb-4 w-full" style={{ maxWidth: size.w || 900 }}>
          {isCreator ? (
            <div className="flex-1 rounded-2xl border p-4 bg-gray-900/80 border-cyan-600 ring-2 ring-cyan-500/50">
              <p className="text-[10px] uppercase font-bold text-cyan-400 mb-1">Mine Layer (You)</p>
              <p className="text-lg font-bold">{creatorName}</p>
              <p className="text-sm text-zinc-400 mt-1">
                {phase === "placing" ? `Placed: ${placedMines.size} / ${maxMines}` : `Mines placed.`}
              </p>
            </div>
          ) : (
            <div className="flex-1 rounded-2xl border p-4 bg-gray-900/80 border-cyan-800 opacity-60">
              <p className="text-[10px] uppercase font-bold text-cyan-600 mb-1">Mine Layer</p>
              <p className="text-lg">{creatorName}</p>
            </div>
          )}

          {!isCreator ? (
            <div className="flex-1 rounded-2xl border p-4 bg-gray-900/80 border-amber-500 ring-2 ring-amber-500/50 flex flex-col justify-between">
              <div>
                <p className="text-[10px] uppercase font-bold text-amber-400 mb-1">Flipper (You)</p>
                <div className="flex justify-between items-end">
                  <p className="text-xl font-bold">{flipperName}</p>
                  <div className="text-right">
                    <p className="text-sm">Score: <span className="font-mono text-cyan-300 font-bold">{score}</span></p>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-sm text-amber-200 font-bold">
                💉 Antidotes: {antidotes} / 5
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-2xl border p-4 bg-gray-900/80 border-amber-800 opacity-80">
              <p className="text-[10px] uppercase font-bold text-amber-600 mb-1">Flipper</p>
              <p className="text-lg">{flipperName || "Waiting for player..."}</p>
              <div className="mt-1 text-xs text-zinc-400 flex justify-between">
                <span>Score: {score}</span>
                <span>Antidotes: {antidotes}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ STATUS BARS & ROOM INFO ═══════ */}
      {phase !== "lobby" && (
        <div className="w-full flex items-center justify-between mb-2 text-sm max-w-[900px]">
          <div className="flex gap-4 items-center">
            <span className="font-mono bg-zinc-800 px-3 py-1 rounded text-cyan-300">Room: {roomCode}</span>
            {phase === "waiting_flipper" && (
              <button onClick={handleCopy} className="text-xs bg-zinc-700 hover:bg-zinc-600 px-2 py-1 rounded transition-colors">
                {copied ? "Copied" : "Copy Link"}
              </button>
            )}
          </div>

          <div className="font-bold">
            {phase === "placing" && <span className="text-cyan-400">Place your mines.</span>}
            {phase === "waiting_flipper" && <span className="text-zinc-400">Waiting for Flipper to join...</span>}
            {phase === "flipping" && <span className="text-amber-400">Flipping phase. Find the safe paths!</span>}
            {phase === "spectating" && <span className="text-cyan-400">Watching Flipper navigate your mines...</span>}
            {phase === "gameover" && <span className={outcome === "won" ? "text-green-400" : "text-red-400"}>Game Over: {outcome?.toUpperCase()}</span>}
          </div>
        </div>
      )}

      {/* Progress / Stats */}
      {(phase === "flipping" || phase === "spectating" || phase === "gameover") && (
        <div className="w-full mb-3 px-1" style={{ maxWidth: size.w || 900 }}>
          <div className="flex justify-between items-center text-[11px] text-zinc-400">
            <span className="bg-zinc-800/80 border border-zinc-700 px-3 py-1 rounded-full uppercase tracking-widest font-bold text-[9px]">
              Mission: Link West cells to most East cell
            </span>
            <span>Safe Areas Cleared: <span className="text-white font-bold">{safeRevealed}</span></span>
          </div>
        </div>
      )}

      {/* ═══════ CANVAS ═══════ */}
      {phase !== "lobby" && (
        <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/20 border border-zinc-700/60" style={{ width: size.w || "auto" }}>
          <canvas ref={canvasRef} width={size.w} height={size.h}
            onClick={handleCanvasClick} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}
            className="block" />

          {/* Place Mines Button Overlay */}
          {phase === "placing" && placedMines.size > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <button onClick={submitMines}
                className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-8 rounded-full shadow-lg shadow-cyan-900/50">
                Lock {placedMines.size} Mines & Ready
              </button>
            </div>
          )}

          {/* Game Over Overlay */}
          {phase === "gameover" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm z-20">
              <div className="bg-zinc-900/95 border border-zinc-600 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
                <div className="text-5xl mb-3">{outcome === "won" ? "🏆" : "💥"}</div>
                <h2 className={`text-2xl font-black mb-2 ${outcome === "won" ? "text-green-400" : "text-red-500"}`}>
                  {outcome === "won" ? "FLIPPER SURVIVED!" : "FLIPPER DESTROYED"}
                </h2>
                <div className="text-zinc-300 mb-6 bg-black/30 p-4 rounded-xl">
                  <p className="flex justify-between mb-1">
                    <span>Final Score:</span> <span className="text-cyan-400 font-bold">{score}</span>
                  </p>
                  <p className="flex justify-between mb-1">
                    <span>Mines Hit:</span> <span className="text-red-400 font-bold">{minesHit}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Safe Found:</span> <span className="font-bold">{safeRevealed}/{safeCells}</span>
                  </p>
                </div>
                <button onClick={() => { setPhase("lobby"); setRoomCode(""); setJoinCode(""); setPlacedMines(new Set()); }}
                  className="px-8 py-3 rounded-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold transition-colors">
                  Back to Lobby
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
