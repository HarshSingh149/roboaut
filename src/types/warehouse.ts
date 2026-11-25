export type CellEntityType = 'shelf' | 'obstacle' | 'pickup' | 'dropoff' | 'parking';

export interface GridCoord {
  x: number; // Integer, increases right
  y: number; // Integer, increases down
}

export interface WarehouseEntity {
  id: string; // Stable prefixed ID: shf_, obs_, pck_, drp_, prk_
  type: CellEntityType;
  x: number;
  y: number;
  label?: string;
}

export interface WarehouseConfig {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** Out-of-bounds integer [x, y] pairs for L-shape, circle, triangle, or custom polygon plots */
  voidCells: [number, number][];
  entities: WarehouseEntity[];
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  coord?: GridCoord;
}

export const coordKey = (x: number, y: number): string => `${x},${y}`;

export const isInsideBounds = (x: number, y: number, rows: number, cols: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < cols && y >= 0 && y < rows;