"use client";

import { useCallback, useEffect, useState } from "react";

const GRID_SIZE = 20;
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE; // 400
const DANGER_COUNT = 40; // ~10% danger cells

type CellState = {
  revealed: boolean;
  isDanger: boolean;
  value: number; // 0-9 for normal, -1 for danger
  claimedBy: 1 | 2 | null;
};

type GameStatus = "idle" | "playing" | "gameover";

function generateGrid(): CellState[] {
  const cells: CellState[] = Array.from({ length: TOTAL_CELLS }, () => ({
    revealed: false,
    isDanger: false,
    value: Math.floor(Math.random() * 10),
    claimedBy: null,
  }));

  // Randomly sprinkle danger cells
  const dangerIndices = new Set<number>();
  while (dangerIndices.size < DANGER_COUNT) {
    dangerIndices.add(Math.floor(Math.random() * TOTAL_CELLS));
  }
  dangerIndices.forEach((i) => {
    cells[i].isDanger = true;
    cells[i].value = -1;
  });

  return cells;
}

const PLAYER_COLORS = {
  1: {
    bg: "bg-cyan-500",
    text: "text-cyan-400",
    border: "border-cyan-500",
    glow: "shadow-cyan-500/50",
    ring: "ring-cyan-500",
    cell: "bg-cyan-500/20 border-cyan-400 text-cyan-300",
    badge: "bg-cyan-900/60 text-cyan-300 border border-cyan-600",
  },
  2: {
    bg: "bg-fuchsia-500",
    text: "text-fuchsia-400",
    border: "border-fuchsia-500",
    glow: "shadow-fuchsia-500/50",
    ring: "ring-fuchsia-500",
    cell: "bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-300",
    badge: "bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-600",
  },
};

export default function GridGame() {
  const [grid, setGrid] = useState<CellState[]>(() => generateGrid());
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [scores, setScores] = useState<{ 1: number; 2: number }>({ 1: 0, 2: 0 });
  const [status, setStatus] = useState<GameStatus>("idle");
  const [winner, setWinner] = useState<1 | 2 | "tie" | null>(null);
  const [lastDangerIdx, setLastDangerIdx] = useState<number | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);

  const showFlash = (msg: string) => {
    setFlashMessage(msg);
    setTimeout(() => setFlashMessage(null), 2200);
  };

  const startGame = () => {
    setGrid(generateGrid());
    setCurrentPlayer(1);
    setScores({ 1: 0, 2: 0 });
    setStatus("playing");
    setWinner(null);
    setLastDangerIdx(null);
    setFlashMessage(null);
  };

  const resetGame = useCallback(() => {
    setGrid(generateGrid());
    setScores({ 1: 0, 2: 0 });
    setCurrentPlayer(1);
    setStatus("playing");
    setWinner(null);
    setLastDangerIdx(null);
  }, []);

  const handleCellClick = (idx: number) => {
    if (status !== "playing") return;
    const cell = grid[idx];
    if (cell.revealed) return;

    setAnimatingIdx(idx);
    setTimeout(() => setAnimatingIdx(null), 400);

    if (cell.isDanger) {
      // Reveal danger briefly then reset
      setLastDangerIdx(idx);
      const newGrid = grid.map((c, i) =>
        i === idx ? { ...c, revealed: true, claimedBy: currentPlayer } : c
      );
      setGrid(newGrid);
      showFlash(`💥 Player ${currentPlayer} hit a DANGER cell! Game Reset!`);

      setTimeout(() => {
        resetGame();
      }, 1800);
      return;
    }

    // Normal cell
    const newGrid = grid.map((c, i) =>
      i === idx ? { ...c, revealed: true, claimedBy: currentPlayer } : c
    );
    setGrid(newGrid);

    const newScores = {
      ...scores,
      [currentPlayer]: scores[currentPlayer] + cell.value,
    };
    setScores(newScores);

    // Check if all non-danger cells are revealed
    const nonDangerCells = newGrid.filter((c) => !c.isDanger);
    const allRevealed = nonDangerCells.every((c) => c.revealed);

    if (allRevealed) {
      setStatus("gameover");
      if (newScores[1] > newScores[2]) setWinner(1);
      else if (newScores[2] > newScores[1]) setWinner(2);
      else setWinner("tie");
    } else {
      setCurrentPlayer(currentPlayer === 1 ? 2 : 1);
    }
  };

  const revealedCount = grid.filter((c) => c.revealed && !c.isDanger).length;
  const safeCount = grid.filter((c) => !c.isDanger).length;
  const progress = Math.round((revealedCount / safeCount) * 100);

  return (
    <div className="min-h-screen bg-[#080b14] text-white font-sans flex flex-col items-center py-6 px-4 select-none">
      {/* Header */}
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-black tracking-widest bg-gradient-to-r from-cyan-400 via-white to-fuchsia-400 bg-clip-text text-transparent uppercase">
          Grid Danger
        </h1>
        <p className="text-zinc-500 text-sm mt-1 tracking-wide">
          2-Player • 20×20 • Avoid the Mines
        </p>
      </div>

      {/* Flash Banner */}
      <div
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${
          flashMessage ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
        }`}
      >
        <div className="bg-red-950 border border-red-500 text-red-200 px-6 py-3 rounded-2xl shadow-2xl shadow-red-900/50 text-base font-bold backdrop-blur-md">
          {flashMessage}
        </div>
      </div>

      {/* Scoreboard */}
      <div className="flex gap-6 mb-6 w-full max-w-4xl">
        {([1, 2] as const).map((p) => {
          const col = PLAYER_COLORS[p];
          const isActive = currentPlayer === p && status === "playing";
          return (
            <div
              key={p}
              className={`flex-1 rounded-2xl border p-4 transition-all duration-300 ${col.border} ${
                isActive
                  ? `bg-gray-900 shadow-lg ${col.glow} ring-2 ${col.ring}`
                  : "bg-gray-900/50 opacity-70"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs tracking-widest uppercase font-bold ${col.text}`}>
                    Player {p}
                  </p>
                  <p className="text-4xl font-black mt-1">{scores[p]}</p>
                </div>
                <div
                  className={`w-12 h-12 rounded-full ${col.bg} flex items-center justify-center text-white font-black text-xl shadow-lg`}
                >
                  {p}
                </div>
              </div>
              {isActive && (
                <div
                  className={`mt-2 text-xs ${col.text} font-semibold flex items-center gap-1`}
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                  Your Turn
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {status === "playing" && (
        <div className="w-full max-w-4xl mb-4">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Progress</span>
            <span>{revealedCount} / {safeCount} safe cells ({progress}%)</span>
          </div>
          <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Start / Game Over Overlay */}
      {status !== "playing" && (
        <div className="flex flex-col items-center gap-6 my-6 p-8 rounded-3xl border border-zinc-700 bg-zinc-900/80 backdrop-blur-xl shadow-2xl max-w-sm w-full text-center">
          {status === "idle" && (
            <>
              <div className="text-5xl">🎮</div>
              <h2 className="text-2xl font-bold">Ready to Play?</h2>
              <p className="text-zinc-400 text-sm">
                Click cells to earn points. Hit a{" "}
                <span className="text-red-400 font-bold">⚠️ Danger</span> cell and the
                game resets! Most points win.
              </p>
            </>
          )}
          {status === "gameover" && (
            <>
              <div className="text-5xl">{winner === "tie" ? "🤝" : "🏆"}</div>
              <h2 className="text-2xl font-bold">
                {winner === "tie"
                  ? "It's a Tie!"
                  : `Player ${winner} Wins!`}
              </h2>
              <div className="flex gap-4 text-sm">
                <div className="bg-cyan-900/40 border border-cyan-700 rounded-xl px-4 py-2">
                  <p className="text-cyan-400 font-bold text-xs uppercase tracking-wider">P1</p>
                  <p className="text-2xl font-black">{scores[1]}</p>
                </div>
                <div className="bg-fuchsia-900/40 border border-fuchsia-700 rounded-xl px-4 py-2">
                  <p className="text-fuchsia-400 font-bold text-xs uppercase tracking-wider">P2</p>
                  <p className="text-2xl font-black">{scores[2]}</p>
                </div>
              </div>
            </>
          )}
          <button
            onClick={startGame}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white font-bold text-base shadow-lg hover:scale-105 active:scale-95 transition-transform duration-150 cursor-pointer"
          >
            {status === "idle" ? "Start Game" : "Play Again"}
          </button>
        </div>
      )}

      {/* Grid */}
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
      >
        {grid.map((cell, idx) => {
          const col = cell.claimedBy ? PLAYER_COLORS[cell.claimedBy] : null;
          const isAnimating = animatingIdx === idx;

          let cellContent: React.ReactNode = null;
          let cellClass =
            "w-[38px] h-[38px] rounded-md border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-500 cursor-pointer transition-all duration-150 flex items-center justify-center text-base font-black ";

          if (status !== "playing") {
            cellClass =
              "w-[38px] h-[38px] rounded-md border border-zinc-800 bg-zinc-900 flex items-center justify-center text-base font-black cursor-not-allowed opacity-50 ";
          }

          if (cell.revealed) {
            if (cell.isDanger) {
              cellClass =
                "w-[38px] h-[38px] rounded-md border border-red-500 bg-red-900/60 flex items-center justify-center text-xl cursor-default ";
              cellContent = "⚠️";
            } else {
              const numColor =
                cell.value >= 8
                  ? "text-yellow-300"
                  : cell.value >= 5
                  ? "text-green-300"
                  : cell.value >= 2
                  ? "text-blue-300"
                  : "text-zinc-400";
              cellClass = `w-[38px] h-[38px] rounded-md border ${col?.border || "border-zinc-600"} ${
                col
                  ? cell.claimedBy === 1
                    ? "bg-cyan-900/40"
                    : "bg-fuchsia-900/40"
                  : "bg-zinc-800"
              } flex items-center justify-center cursor-default ${numColor} `;
              cellContent = cell.value;
            }
          }

          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              disabled={status !== "playing" || cell.revealed}
              className={`${cellClass} ${isAnimating ? "scale-110" : "scale-100"}`}
              aria-label={`Cell ${idx}`}
            >
              {cellContent}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-6 mt-6 text-xs text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-cyan-900/60 border border-cyan-600 inline-block" />
          Player 1
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-fuchsia-900/60 border border-fuchsia-600 inline-block" />
          Player 2
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-red-900/60 border border-red-500 inline-block" />
          ⚠️ Danger (resets game)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-zinc-800 border border-zinc-700 inline-block" />
          Unrevealed
        </span>
      </div>
    </div>
  );
}
