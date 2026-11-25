export type RobotPhase =
  | 'idle'
  | 'toPick'
  | 'picking'
  | 'toCounter'
  | 'dropping'
  | 'toSlot'
  | 'failed';

export interface MapfRobot {
  id: number;
  c: number;
  pc: number;
  phase: RobotPhase;
  item: boolean;
  failed: boolean;
  order: number;
  slot: number;
  goal: number;
  cnt: number;
}

export interface DynamicHazard {
  id: string;
  type: 'fire' | 'obstacle';
  c: number;
  x: number;
  y: number;
  radius: number;
}

export interface MapfSnapshot {
  N: number;
  version: number;
  tick: number;
  done: number;
  cols: number;
  waitTicks: number;
  failedCount: number;
  planMs: number;
  pendingOrders: number;
  inProgress: number;
  shelfList: number[];
  counters: number[];
  restCells: number[];
  activeRest: number[];
  parkCells: number[];
  voidMask: Uint8Array;
  walkMask: Uint8Array;
  shelfMask: Uint8Array;
  hotShelves: Set<number>;
  hazards: DynamicHazard[];
  robots: MapfRobot[];
  notice: string;
}