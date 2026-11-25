import type { MapfSnapshot } from '../types/simulation';

const THEME = {
  out: '#0e1210',
  floor: '#222a27',
  shelf: '#b99256',
  bay: '#2b6bc0',
  park: '#2f3935',
  hot: '#ff7a5c',
};

export class WarehouseRenderer {
  private bgCanvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private cachedVersion = -1;
  private cachedSize = 0;

  constructor(size = 900) {
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = size;
    this.bgCanvas.height = size;
    this.bgCtx = this.bgCanvas.getContext('2d')!;
  }

  private rebuildStatic(snap: MapfSnapshot, canvasSize: number) {
    if (this.bgCanvas.width !== canvasSize) {
      this.bgCanvas.width = canvasSize;
      this.bgCanvas.height = canvasSize;
    }

    const { N, voidMask, shelfMask, parkCells, activeRest, counters, shelfList } = snap;
    const M = N * N;
    const cs = canvasSize / N;
    const ctx = this.bgCtx;

    // 1. Out-of-bounds / void background
    ctx.fillStyle = THEME.out;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // 2. Active floor tiles (anything not voidMask and not shelfMask)
    ctx.fillStyle = THEME.floor;
    for (let c = 0; c < M; c++) {
      if (!voidMask[c] && !shelfMask[c]) {
        ctx.fillRect((c % N) * cs, ((c / N) | 0) * cs, cs + 0.5, cs + 0.5);
      }
    }

    // 3. Corner parking squares & active rest point dots
    ctx.fillStyle = THEME.park;
    for (const c of parkCells) {
      ctx.fillRect((c % N) * cs + cs * 0.2, ((c / N) | 0) * cs + cs * 0.2, cs * 0.6, cs * 0.6);
    }
    for (const c of activeRest) {
      ctx.beginPath();
      ctx.arc(((c % N) + 0.5) * cs, (((c / N) | 0) + 0.5) * cs, cs * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Counters (blue drop-off bays)
    ctx.fillStyle = THEME.bay;
    for (const c of counters) {
      ctx.fillRect((c % N) * cs, ((c / N) | 0) * cs, cs, cs);
    }

    // 5. Static shelves
    ctx.fillStyle = THEME.shelf;
    for (const c of shelfList) {
      ctx.fillRect((c % N) * cs + 1, ((c / N) | 0) * cs + 1, cs - 2, cs - 2);
    }

    this.cachedVersion = snap.version;
    this.cachedSize = canvasSize;
  }

  render(ctx: CanvasRenderingContext2D, snap: MapfSnapshot, canvasSize: number) {
    if (this.cachedVersion !== snap.version || this.cachedSize !== canvasSize) {
      this.rebuildStatic(snap, canvasSize);
    }

    // Blit cached static layer
    ctx.drawImage(this.bgCanvas, 0, 0);

    const cs = canvasSize / snap.N;

    // Highlight shelves with pending/active orders
    ctx.fillStyle = THEME.hot;
    for (const c of snap.hotShelves) {
      if (snap.shelfMask[c]) {
        ctx.fillRect((c % snap.N) * cs + 1, ((c / snap.N) | 0) * cs + 1, cs - 2, cs - 2);
      }
    }

    // Render live fire / dynamic obstacle hazards
    for (const h of snap.hazards) {
      const cx = (h.x + 0.5) * cs;
      const cy = (h.y + 0.5) * cs;
      if (h.type === 'fire') {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.beginPath();
        ctx.arc(cx, cy, (h.radius + 0.65) * cs, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(cx, cy, cs * 0.38, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(h.x * cs + 2, h.y * cs + 2, cs - 4, cs - 4);
      }
    }
  }
}