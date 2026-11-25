import type { WarehouseConfig } from '../types/warehouse';
import type { SimulationFrame, TaskDispatchPayload } from '../types/simulation';

export type FrameListener = (frame: SimulationFrame) => void;
export type ConnectionListener = (connected: boolean, mode: 'remote' | 'mock') => void;

export interface ISimulationClient {
  connect(wsUrl?: string): void;
  disconnect(): void;
  onFrame(listener: FrameListener): () => void;
  onConnectionChange(listener: ConnectionListener): () => void;
  loadWarehouse(config: WarehouseConfig, robotCount: number): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  step(): Promise<void>;
  reset(): Promise<void>;
  dispatchTask(task: TaskDispatchPayload): Promise<void>;
  injectHazard(type: 'fire' | 'dynamic_obstacle', x: number, y: number, radius?: number): Promise<void>;
  clearHazards(): Promise<void>;
}

export class SimulationClient implements ISimulationClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private frameListeners = new Set<FrameListener>();
  private connListeners = new Set<ConnectionListener>();
  private mode: 'remote' | 'mock' = 'remote';

  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  connect(wsUrl?: string) {
    this.disconnect();
    const target = wsUrl ?? `${this.baseUrl.replace(/^http/, 'ws')}/ws/telemetry`;

    try {
      this.ws = new WebSocket(target);
      this.ws.onopen = () => {
        this.mode = 'remote';
        this.emitConnection(true, 'remote');
      };
      this.ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data) as SimulationFrame;
          this.frameListeners.forEach((fn) => fn(frame));
        } catch {
          // Ignore malformed telemetry packets
        }
      };
      this.ws.onclose = () => this.emitConnection(false, this.mode);
      this.ws.onerror = () => this.emitConnection(false, this.mode);
    } catch {
      this.emitConnection(false, 'remote');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connListeners.add(listener);
    return () => this.connListeners.delete(listener);
  }

  private emitConnection(connected: boolean, mode: 'remote' | 'mock') {
    this.connListeners.forEach((fn) => fn(connected, mode));
  }

  private async post(path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Backend error ${res.status} on ${path}`);
    }
  }

  async loadWarehouse(config: WarehouseConfig, robotCount: number): Promise<void> {
    await this.post('/api/warehouse/load', { config, robotCount });
  }

  async start(): Promise<void> {
    await this.post('/api/sim/start');
  }

  async pause(): Promise<void> {
    await this.post('/api/sim/pause');
  }

  async step(): Promise<void> {
    await this.post('/api/sim/step');
  }

  async reset(): Promise<void> {
    await this.post('/api/sim/reset');
  }

  async dispatchTask(task: TaskDispatchPayload): Promise<void> {
    await this.post('/api/tasks/dispatch', task);
  }

  async injectHazard(
    type: 'fire' | 'dynamic_obstacle',
    x: number,
    y: number,
    radius = 1
  ): Promise<void> {
    await this.post('/api/hazards/inject', { type, x, y, radius });
  }

  async clearHazards(): Promise<void> {
    await this.post('/api/hazards/clear');
  }
}

export const simulationClient = new SimulationClient();