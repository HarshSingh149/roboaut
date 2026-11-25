import type { MapfRobot, RobotPhase } from '../types/simulation';

const PHASE_COLORS: Record<RobotPhase, string> = {
  idle: '#8a948f',
  toPick: '#2f7de1',
  picking: '#e0a21a',
  toCounter: '#25a56a',
  dropping: '#127a4a',
  toSlot: '#8a56d6',
  failed: '#dc2626',
};

export function renderRobots(
  ctx: CanvasRenderingContext2D,
  robots: MapfRobot[],
  N: number,
  canvasSize: number,
  alpha: number
) {
  const cs = canvasSize / N;
  const a = Math.max(0, Math.min(1, alpha));
  const showLabels = cs >= 15;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(9, cs * 0.38)}px system-ui, sans-serif`;

  for (const r of robots) {
    const px = r.pc % N;
    const py = (r.pc / N) | 0;
    const cx = r.c % N;
    const cy = (r.c / N) | 0;

    const x = (px + (cx - px) * a + 0.5) * cs;
    const y = (py + (cy - py) * a + 0.5) * cs;

    ctx.fillStyle = PHASE_COLORS[r.phase];
    ctx.beginPath();
    ctx.arc(x, y, cs * 0.38, 0, Math.PI * 2);
    ctx.fill();

    if (r.failed) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, cs * 0.08);
      const d = cs * 0.18;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d);
      ctx.lineTo(x - d, y + d);
      ctx.stroke();
    } else if (r.item) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - cs * 0.14, y - cs * 0.14, cs * 0.28, cs * 0.28);
    } else if (showLabels) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(r.id), x, y);
    }
  }
}