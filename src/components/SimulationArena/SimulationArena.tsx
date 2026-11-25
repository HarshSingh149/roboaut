import React, { useEffect, useRef, useState } from 'react';
import { MapfEngine } from '../../engine/MapfEngine';
import type { MapfSnapshot } from '../../types/simulation';
import { WarehouseRenderer } from '../../visualization/WarehouseRenderer';
import { renderRobots } from '../../visualization/RobotRenderer';

export type PlotShape = 'rect' | 'lshape' | 'circle' | 'triangle' | 'custom';
type BrushMode = 'shelf' | 'counter' | 'order' | 'fire' | 'fail' | 'void';

function buildVoidCells(size: number, shape: PlotShape): [number, number][] {
  const voids: [number, number][] = [];
  if (shape === 'rect' || shape === 'custom') return voids;

  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size * 0.48;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (shape === 'lshape') {
        if (x >= Math.floor(size * 0.55) && y < Math.floor(size * 0.45)) voids.push([x, y]);
      } else if (shape === 'circle') {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) voids.push([x, y]);
      } else if (shape === 'triangle') {
        const halfWidth = ((y + 1) / size) * (size / 2);
        if (Math.abs(x - cx) > halfWidth) voids.push([x, y]);
      }
    }
  }
  return voids;
}

export const SimulationArena: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MapfEngine | null>(null);
  const rendererRef = useRef<WarehouseRenderer>(new WarehouseRenderer(900));

  if (!engineRef.current) {
    engineRef.current = new MapfEngine(36, 50, 10);
  }

  const [snap, setSnap] = useState<MapfSnapshot>(() => engineRef.current!.snapshot());
  const [fps, setFps] = useState(60);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<BrushMode>('shelf');
  const [shape, setShape] = useState<PlotShape>('rect');

  const [gridSize, setGridSize] = useState(36);
  const [startRobots, setStartRobots] = useState(50);
  const [reserve, setReserve] = useState(10);
  const [customAdd, setCustomAdd] = useState(25);
  const [orderRate, setOrderRate] = useState(4);
  const [speed, setSpeed] = useState(8);

  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  pausedRef.current = paused;
  speedRef.current = speed;

  const paintingRef = useRef(false);
  const drawValRef = useRef(false);

  useEffect(() => {
    let rafId = 0;
    let acc = 0;
    let last = performance.now();
    let fpsT = last;
    let fpsN = 0;
    let frameCount = 0;

    const loop = (ts: number) => {
      const engine = engineRef.current!;
      const dt = Math.min(0.25, (ts - last) / 1000);
      last = ts;

      if (!pausedRef.current) {
        acc += dt * speedRef.current;
        let steps = 0;
        while (acc >= 1 && steps < 6) {
          acc -= 1;
          engine.step();
          steps++;
        }
        if (acc > 1) acc = 1;
      }

      const currentSnap = engine.snapshot();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        rendererRef.current.render(ctx, currentSnap, canvas.width);
        renderRobots(
          ctx,
          currentSnap.robots,
          currentSnap.N,
          canvas.width,
          pausedRef.current ? 1 : Math.min(1, acc)
        );
      }

      if (++frameCount % 3 === 0 || pausedRef.current) {
        setSnap(currentSnap);
      }

      fpsN++;
      if (ts - fpsT >= 1000) {
        setFps(fpsN);
        fpsN = 0;
        fpsT = ts;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const cv = canvasRef.current;
    const engine = engineRef.current;
    if (!cv || !engine) return -1;
    const b = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - b.left) / b.width) * engine.N);
    const y = Math.floor(((e.clientY - b.top) / b.height) * engine.N);
    return x < 0 || y < 0 || x >= engine.N || y >= engine.N ? -1 : y * engine.N + x;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current!;
    const c = cellAt(e);
    if (c < 0) return;

    if (mode === 'order') {
      engine.orderShelf(c);
      setSnap(engine.snapshot());
      return;
    }
    if (mode === 'fire') {
      engine.injectHazard('fire', c, 1);
      setSnap(engine.snapshot());
      return;
    }
    if (mode === 'counter') {
      engine.toggleCounter(c);
      setSnap(engine.snapshot());
      return;
    }
    if (mode === 'fail') {
      engine.failRobotAt(c);
      setSnap(engine.snapshot());
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    paintingRef.current = true;
    if (mode === 'void') {
      drawValRef.current = !snap.voidMask[c];
      engine.toggleVoid(c, drawValRef.current);
    } else {
      drawValRef.current = !snap.shelfMask[c];
      engine.toggleShelf(c, drawValRef.current);
    }
    setSnap(engine.snapshot());
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return;
    const engine = engineRef.current!;
    const c = cellAt(e);
    if (c < 0) return;
    if (mode === 'shelf') {
      engine.toggleShelf(c, drawValRef.current);
      setSnap(engine.snapshot());
    } else if (mode === 'void') {
      engine.toggleVoid(c, drawValRef.current);
      setSnap(engine.snapshot());
    }
  };

  const rebuildWorld = (keepShelves: boolean, nextShape: PlotShape = shape) => {
    const engine = engineRef.current!;
    const clampedSize = Math.min(64, Math.max(16, gridSize | 0));
    setGridSize(clampedSize);
    engine.reserve = Math.max(0, reserve | 0);
    engine.newWorld(
      Math.max(1, startRobots | 0),
      clampedSize,
      keepShelves,
      buildVoidCells(clampedSize, nextShape)
    );
    setSnap(engine.snapshot());
  };

  const activeRobots = snap.robots.filter((r) => !r.failed && r.phase !== 'idle').length;

  return (
    <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
      {/* Left: Arena & Telemetry */}
      <section className="bg-[#1b2220] border border-[#323c38] rounded-xl p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h1 className="text-lg font-bold text-[#e6ebe8]">Warehouse Fleet · Space-Time A*</h1>
            <p className="text-xs text-[#97a39d]">
              {snap.N}×{snap.N} floor · {snap.counters.length} counter(s) · zero vertex or edge-swap collisions
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['rect', 'lshape', 'circle', 'triangle', 'custom'] as PlotShape[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setShape(s);
                  if (s === 'custom') {
                    setMode('void');
                  } else {
                    rebuildWorld(false, s);
                  }
                }}
                className={`px-2.5 py-1 rounded text-xs capitalize border ${
                  shape === s
                    ? 'bg-[#58c4a6] text-[#121715] border-[#58c4a6] font-semibold'
                    : 'bg-[#121715] text-[#e6ebe8] border-[#323c38] hover:border-[#58c4a6]'
                }`}
              >
                {s === 'lshape' ? 'L-Shape' : s === 'custom' ? 'Custom / Irregular' : s}
              </button>
            ))}
          </div>
        </div>

        {/* 8-Metric Telemetry Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <StatCard label="tick" value={snap.tick} />
          <StatCard label="active / total robots" value={`${activeRobots} / ${snap.robots.length}`} />
          <StatCard label="collisions" value={snap.cols} tone={snap.cols === 0 ? 'ok' : 'bad'} />
          <StatCard label="planner ms / tick" value={snap.planMs.toFixed(1)} />
          <StatCard label="pending / in progress" value={`${snap.pendingOrders} / ${snap.inProgress}`} />
          <StatCard label="completed" value={snap.done} />
          <StatCard label="wait ticks" value={snap.waitTicks} />
          <StatCard label="frames / s" value={fps} />
        </div>

        <canvas
          ref={canvasRef}
          width={900}
          height={900}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => (paintingRef.current = false)}
          onPointerCancel={() => (paintingRef.current = false)}
          className="w-full aspect-square rounded-lg bg-[#0e1210] cursor-crosshair touch-none block"
        />

        <p className="text-xs text-[#97a39d] mt-2.5 leading-relaxed">
          Robots: grey idle · blue to shelf · amber picking · green to counter · dark green dropping ·
          violet to parking · red X = failed robot. White square = carrying item. Blue cells = counters.
        </p>
      </section>

      {/* Right: Control Sidebar */}
      <aside className="bg-[#1b2220] border border-[#323c38] rounded-xl p-3.5 flex flex-col gap-3 text-sm text-[#e6ebe8]">
        <div>
          <span className="block text-xs text-[#97a39d] mb-1.5">Click / Drag Mode</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['shelf', 'Shelf (Draw/Erase)'],
                ['counter', 'Add / Remove Counter'],
                ['order', 'Place Order'],
                ['fire', 'Inject Fire'],
                ['fail', 'Fail / Repair Robot'],
                ['void', 'Carve Custom Shape'],
              ] as [BrushMode, string][]
            ).map(([val, label]) => (
              <label
                key={val}
                className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                  mode === val
                    ? 'border-[#58c4a6] bg-[#121715] text-[#58c4a6]'
                    : 'border-[#323c38] bg-[#121715]'
                }`}
              >
                <input
                  type="radio"
                  name="brushMode"
                  checked={mode === val}
                  onChange={() => setMode(val)}
                  className="accent-[#58c4a6]"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => {
              engineRef.current!.restoreDefaultShelves();
              setSnap(engineRef.current!.snapshot());
            }}
            className="px-2.5 py-1 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] text-xs"
          >
            Default layout
          </button>
          <button
            onClick={() => {
              engineRef.current!.clearShelves();
              setSnap(engineRef.current!.snapshot());
            }}
            className="px-2.5 py-1 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] text-xs"
          >
            Clear shelves
          </button>
          {snap.hazards.length > 0 && (
            <button
              onClick={() => {
                engineRef.current!.clearHazards();
                setSnap(engineRef.current!.snapshot());
              }}
              className="px-2.5 py-1 rounded bg-rose-950 border border-rose-700 text-rose-200 text-xs"
            >
              Clear fire ({snap.hazards.length})
            </button>
          )}
          {snap.failedCount > 0 && (
            <button
              onClick={() => {
                engineRef.current!.repairAllRobots();
                setSnap(engineRef.current!.snapshot());
              }}
              className="px-2.5 py-1 rounded bg-amber-950 border border-amber-700 text-amber-200 text-xs"
            >
              Repair all ({snap.failedCount})
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-[#97a39d] mb-1">Grid size</label>
            <input
              type="number"
              min={16}
              max={64}
              value={gridSize}
              onChange={(e) => setGridSize(Number(e.target.value))}
              className="w-full px-2 py-1 rounded bg-[#121715] border border-[#323c38]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#97a39d] mb-1">Start robots</label>
            <input
              type="number"
              min={1}
              max={200}
              value={startRobots}
              onChange={(e) => setStartRobots(Number(e.target.value))}
              className="w-full px-2 py-1 rounded bg-[#121715] border border-[#323c38]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#97a39d] mb-1">Reserve</label>
            <input
              type="number"
              min={0}
              max={100}
              value={reserve}
              onChange={(e) => setReserve(Number(e.target.value))}
              className="w-full px-2 py-1 rounded bg-[#121715] border border-[#323c38]"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => rebuildWorld(false)}
            className="flex-1 py-1.5 rounded bg-[#58c4a6] text-[#121715] font-semibold text-xs"
          >
            Rebuild (new layout)
          </button>
          <button
            onClick={() => rebuildWorld(true)}
            className="flex-1 py-1.5 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] text-xs"
          >
            Reset (keep shelves)
          </button>
        </div>

        <div>
          <span className="block text-xs text-[#97a39d] mb-1">Robots: {snap.robots.length}</span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {[1, 5, 10, -1].map((delta) => (
              <button
                key={delta}
                onClick={() => {
                  engineRef.current!.addRobots(delta);
                  setSnap(engineRef.current!.snapshot());
                }}
                className="px-2.5 py-1 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] text-xs"
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
            <input
              type="number"
              min={1}
              value={customAdd}
              onChange={(e) => setCustomAdd(Number(e.target.value))}
              className="w-16 px-2 py-1 rounded bg-[#121715] border border-[#323c38] text-xs"
            />
            <button
              onClick={() => {
                engineRef.current!.addRobots(Math.max(1, customAdd | 0));
                setSnap(engineRef.current!.snapshot());
              }}
              className="px-2.5 py-1 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] text-xs"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#97a39d] mb-1">
            Order rate: {orderRate} per 10 ticks
          </label>
          <input
            type="range"
            min={0}
            max={30}
            value={orderRate}
            onChange={(e) => {
              const v = Number(e.target.value);
              setOrderRate(v);
              engineRef.current!.rate = v;
            }}
            className="w-full accent-[#58c4a6]"
          />
        </div>

        <div>
          <label className="block text-xs text-[#97a39d] mb-1">Speed: {speed} ticks/s</label>
          <input
            type="range"
            min={1}
            max={60}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-full accent-[#58c4a6]"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setPaused((p) => !p)}
            className="flex-1 py-1.5 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] font-medium"
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => {
              engineRef.current!.orderRandom();
              setSnap(engineRef.current!.snapshot());
            }}
            className="flex-1 py-1.5 rounded bg-[#121715] border border-[#323c38] hover:border-[#58c4a6] font-medium"
          >
            Order now
          </button>
        </div>

        {snap.notice && <div className="text-xs text-[#ff7a5c] min-h-[18px]">{snap.notice}</div>}

        <p className="text-xs text-[#97a39d]">
          Shelves: {snap.shelfList.length} · counters: {snap.counters.length} · rest points:{' '}
          {snap.restCells.length} · parking: {snap.parkCells.length}
        </p>
      </aside>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; tone?: 'ok' | 'bad' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="border border-[#323c38] rounded-lg px-2.5 py-1.5 bg-[#121715]">
    <b
      className={`block text-lg tabular-nums ${
        tone === 'ok' ? 'text-[#58c4a6]' : tone === 'bad' ? 'text-[#ff7a5c]' : 'text-[#e6ebe8]'
      }`}
    >
      {value}
    </b>
    <span className="text-[11px] text-[#97a39d]">{label}</span>
  </div>
);