import type { DynamicHazard, MapfRobot, MapfSnapshot, RobotPhase } from '../types/simulation';

const INF = 30000;
const H = 192;
const RING = 256;
const EXP_BUDGET = 60000;
const HCAP = 60000;

interface InternalRobot {
  id: number;
  c: number;
  pc: number;
  phase: 'idle' | 'toPick' | 'toCounter' | 'toSlot' | 'failed';
  path: number[] | null;
  t0: number;
  dwell: number;
  need: boolean;
  retry: number;
  fails: number;
  item: boolean;
  failed: boolean;
  order: number;
  slot: number;
  goal: number;
  cnt: number;
  detour: number;
}

export class MapfEngine {
  N = 36;
  M = 36 * 36;
  rate = 4;
  reserve = 10;

  private voidMask = new Uint8Array(0);
  private shelf = new Uint8Array(0);
  private walk = new Uint8Array(0);
  private pickup = new Int32Array(0);
  private claim = new Int32Array(0);
  private slotKind = new Uint8Array(0);
  private permO = new Int32Array(0);
  private permF = new Int32Array(0);
  private lastRes = new Int32Array(0);
  private pickBy = new Int32Array(0);
  private resT = new Int32Array(0);
  private resI = new Int16Array(0);
  private edT = new Int32Array(0);
  private edTo = new Int16Array(0);
  private seen = new Int32Array(0);
  private par = new Int32Array(0);
  private dC = new Int16Array(0);
  private cLoad = new Int16Array(0);
  private occT = new Int32Array(0);
  private occI = new Int32Array(0);

  private HK = new Int32Array(HCAP);
  private HV = new Int32Array(HCAP);
  private hn = 0;

  private shelfList: number[] = [];
  private customCounters: number[] | null = null;
  private counters: number[] = [];
  private restCells: number[] = [];
  private parkCells: number[] = [];
  private activeRest: number[] = [];
  private activeCount = 0;

  private robots: InternalRobot[] = [];
  private orders: number[] = [];
  private hazards: DynamicHazard[] = [];
  private tick = 0;
  private done = 0;
  private cols = 0;
  private waitTicks = 0;
  private stamp = 0;
  private occStamp = 0;
  private distCache = new Map<number, Int16Array>();
  private lastBlockers: number[] = [];
  private lastEx = 0;
  private planMs = 0;
  private version = 0;
  private notice = '';
  private noticeAt = 0;

  constructor(size = 36, startRobots = 50, reserve = 10) {
    this.reserve = reserve;
    this.newWorld(startRobots, size, false);
  }

  private note(s: string) {
    this.notice = s;
    this.noticeAt = Date.now();
  }

  private alloc(n: number) {
    this.N = n;
    this.M = n * n;
    const M = this.M;
    this.voidMask = new Uint8Array(M);
    this.shelf = new Uint8Array(M);
    this.walk = new Uint8Array(M);
    this.pickup = new Int32Array(M).fill(-1);
    this.claim = new Int32Array(M).fill(-1);
    this.slotKind = new Uint8Array(M);
    this.permO = new Int32Array(M).fill(-1);
    this.permF = new Int32Array(M);
    this.lastRes = new Int32Array(M).fill(-1);
    this.pickBy = new Int32Array(M).fill(-1);
    this.resT = new Int32Array(RING * M).fill(-1);
    this.resI = new Int16Array(RING * M);
    this.edT = new Int32Array(RING * M).fill(-1);
    this.edTo = new Int16Array(RING * M);
    this.seen = new Int32Array(H * M);
    this.par = new Int32Array(H * M);
    this.stamp = 0;
    this.cLoad = new Int16Array(M);
    this.occT = new Int32Array(M);
    this.occI = new Int32Array(M);
    this.occStamp = 0;
    this.distCache = new Map();
    this.dC = new Int16Array(M);
  }

  private hpush(k: number, v: number) {
    if (this.hn >= HCAP) return;
    let i = this.hn++;
    while (i) {
      const q = (i - 1) >> 1;
      if (this.HK[q] <= k) break;
      this.HK[i] = this.HK[q];
      this.HV[i] = this.HV[q];
      i = q;
    }
    this.HK[i] = k;
    this.HV[i] = v;
  }

  private hpop(): number {
    const top = this.HV[0];
    this.hn--;
    if (this.hn > 0) {
      const k = this.HK[this.hn];
      const v = this.HV[this.hn];
      let i = 0;
      for (;;) {
        let l = 2 * i + 1;
        if (l >= this.hn) break;
        if (l + 1 < this.hn && this.HK[l + 1] < this.HK[l]) l++;
        if (this.HK[l] >= k) break;
        this.HK[i] = this.HK[l];
        this.HV[i] = this.HV[l];
        i = l;
      }
      this.HK[i] = k;
      this.HV[i] = v;
    }
    return top;
  }

  private bfs(srcs: number[]): Int16Array {
    const { N, M, walk } = this;
    const d = new Int16Array(M).fill(INF);
    const q = new Int32Array(M);
    let h = 0;
    let t = 0;
    for (const s of srcs) {
      if (s >= 0 && s < M && walk[s] && d[s] === INF) {
        d[s] = 0;
        q[t++] = s;
      }
    }
    while (h < t) {
      const c = q[h++];
      const x = c % N;
      const dd = d[c] + 1;
      if (x > 0 && walk[c - 1] && d[c - 1] === INF) { d[c - 1] = dd; q[t++] = c - 1; }
      if (x < N - 1 && walk[c + 1] && d[c + 1] === INF) { d[c + 1] = dd; q[t++] = c + 1; }
      if (c >= N && walk[c - N] && d[c - N] === INF) { d[c - N] = dd; q[t++] = c - N; }
      if (c < M - N && walk[c + N] && d[c + N] === INF) { d[c + N] = dd; q[t++] = c + N; }
    }
    return d;
  }

  private distF(g: number): Int16Array {
    let d = this.distCache.get(g);
    if (!d) {
      if (this.distCache.size > 300) this.distCache.clear();
      d = this.bfs([g]);
      this.distCache.set(g, d);
    }
    return d;
  }

  defaultShelves() {
    const { N, shelf, voidMask } = this;
    shelf.fill(0);
    const nb = Math.max(0, Math.floor((N - 6) / 6));
    for (let by = 3; by <= N - 5; by += 3) {
      for (let b = 0; b < nb; b++) {
        for (let i = 0; i < 4; i++) {
          const x = 4 + b * 6 + i;
          const c = by * N + x;
          if (x <= N - 4 && !voidMask[c]) shelf[c] = 1;
        }
      }
    }
  }

  buildGrid() {
    const { N, M, shelf, voidMask } = this;
    this.distCache = new Map();

    // Use custom counters if set, otherwise default 3 on left edge
    if (this.customCounters && this.customCounters.length > 0) {
      this.counters = this.customCounters.filter((c) => c >= 0 && c < M && !voidMask[c]);
      for (const c of this.counters) shelf[c] = 0;
    } else {
      this.counters = [];
      const my = N >> 1;
      for (let k = -1; k <= 1; k++) {
        const y = my + k;
        for (let x = 0; x < N; x++) {
          const c = y * N + x;
          if (!voidMask[c]) {
            shelf[c] = 0;
            this.counters.push(c);
            break;
          }
        }
      }
      this.customCounters = [...this.counters];
    }

    // Dynamic hazards + failed robots block floor cells
    const dynBlocked = new Uint8Array(M);
    for (const h of this.hazards) {
      const hx = h.c % N;
      const hy = (h.c / N) | 0;
      for (let dy = -h.radius; dy <= h.radius; dy++) {
        for (let dx = -h.radius; dx <= h.radius; dx++) {
          if (dx * dx + dy * dy <= h.radius * h.radius) {
            const nx = hx + dx;
            const ny = hy + dy;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N) dynBlocked[ny * N + nx] = 1;
          }
        }
      }
    }
    for (const r of this.robots) {
      if (r.failed) dynBlocked[r.c] = 1;
    }

    for (let c = 0; c < M; c++) {
      this.walk[c] = voidMask[c] || shelf[c] || dynBlocked[c] ? 0 : 1;
    }

    this.dC = this.bfs(this.counters);

    this.shelfList = [];
    this.pickup.fill(-1);
    const rs = new Set<number>();
    for (let c = 0; c < M; c++) {
      if (shelf[c] && !voidMask[c]) {
        this.shelfList.push(c);
        const x = c % N;
        const y = (c / N) | 0;
        const cand = [
          y < N - 1 ? c + N : -1,
          y > 0 ? c - N : -1,
          x > 0 ? c - 1 : -1,
          x < N - 1 ? c + 1 : -1,
        ];
        for (const n of cand) {
          if (n >= 0 && this.walk[n] && this.dC[n] < INF && !this.counters.includes(n)) {
            this.pickup[c] = n;
            rs.add(n);
            break;
          }
        }
      }
    }
    this.restCells = [...rs].sort((a, b) => a - b);

    const ps: [number, number][] = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = y * N + x;
        if (voidMask[c] || ((x + y) & 1) || !this.walk[c] || this.dC[c] >= INF || rs.has(c)) continue;
        const isEdge =
          x === 0 || y === 0 || x === N - 1 || y === N - 1 ||
          voidMask[c - 1] || voidMask[c + 1] || voidMask[c - N] || voidMask[c + N];
        if (!isEdge) continue;
        if (this.counters.some((k) => Math.abs((k % N) - x) + Math.abs(((k / N) | 0) - y) <= 3)) continue;
        ps.push([Math.min(x, N - 1 - x) + Math.min(y, N - 1 - y), c]);
      }
    }
    ps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.parkCells = ps.map((p) => p[1]);

    this.activeRest = [];
    const K = Math.min(this.restCells.length, this.activeCount);
    for (let i = 0; i < K; i++) {
      this.activeRest.push(this.restCells[Math.floor(((i + 0.5) * this.restCells.length) / K)]);
    }

    this.slotKind.fill(0);
    this.restCells.forEach((c) => (this.slotKind[c] = 1));
    this.parkCells.forEach((c) => (this.slotKind[c] = 2));
    this.version++;
  }

  private pickSlot(r: InternalRobot) {
    if (r.slot >= 0 && this.claim[r.slot] === r.id) this.claim[r.slot] = -1;
    r.slot = -1;
    const d = this.distF(r.c);
    let best = -1;
    let bd = INF;
    const consider = (arr: number[]) => {
      for (const s of arr) {
        if (this.claim[s] >= 0 || (this.permO[s] >= 0 && this.permO[s] !== r.id)) continue;
        if (d[s] < bd) { bd = d[s]; best = s; }
      }
    };
    consider(this.parkCells);
    if (best < 0) consider(this.activeRest);
    if (best < 0) consider(this.restCells);
    if (best >= 0) {
      this.claim[best] = r.id;
      r.slot = best;
      r.goal = best;
    } else {
      r.goal = r.c;
    }
  }

  private pickCounter(r: InternalRobot) {
    let best = this.counters[0];
    let bs = 1e9;
    for (const k of this.counters) {
      const d = this.distF(k)[r.c];
      if (d >= INF) continue;
      const s = d + 6 * this.cLoad[k];
      if (s < bs) { bs = s; best = k; }
    }
    r.cnt = best;
    this.cLoad[best]++;
    r.goal = best;
  }

  private makeRobot(id: number, c: number): InternalRobot {
    return {
      id, c, pc: c, phase: 'idle', path: null, t0: 0, dwell: 0,
      need: false, retry: 0, fails: 0, item: false, failed: false,
      order: -1, slot: -1, goal: -1, cnt: -1, detour: -1,
    };
  }

  resetPlanning() {
    this.resT.fill(-1);
    this.edT.fill(-1);
    this.lastRes.fill(-1);
    this.permO.fill(-1);
    this.pickBy.fill(-1);
    this.claim.fill(-1);
    this.cLoad.fill(0);
    this.orders = this.orders.filter((sc) => this.shelf[sc] && this.pickup[sc] >= 0);

    for (const r of this.robots) {
      r.path = null;
      r.pc = r.c;
      r.detour = -1;
      r.fails = 0;
      r.retry = 0;
      r.slot = -1;
      r.cnt = -1;
      this.permO[r.c] = r.id;
      this.permF[r.c] = this.tick;
    }
    for (const r of this.robots) {
      if (!r.failed && r.phase === 'idle' && this.slotKind[r.c] > 0 && this.claim[r.c] < 0) {
        this.claim[r.c] = r.id;
        r.slot = r.c;
      }
    }
    for (const r of this.robots) {
      if (r.failed) continue;
      if (r.phase === 'toPick') {
        const sc = r.order;
        if (sc >= 0 && this.shelf[sc] && this.pickup[sc] >= 0 && this.dC[r.c] < INF && this.pickBy[this.pickup[sc]] < 0) {
          r.goal = this.pickup[sc];
          this.pickBy[r.goal] = r.id;
          r.need = true;
        } else {
          r.order = -1;
          r.phase = 'toSlot';
          this.pickSlot(r);
          r.need = true;
        }
      } else if (r.phase === 'toCounter') {
        this.pickCounter(r);
        r.need = true;
      } else if (r.phase === 'toSlot' || (r.phase === 'idle' && r.slot < 0)) {
        r.phase = 'toSlot';
        this.pickSlot(r);
        r.need = true;
      }
    }
  }

  toggleShelf(c: number, val: boolean): boolean {
    if (c < 0 || c >= this.M || this.voidMask[c] || this.counters.includes(c) || !!this.shelf[c] === val) return true;
    if (val) {
      for (const r of this.robots) {
        if (r.c === c || r.pc === c) {
          this.note('A robot is standing there');
          return false;
        }
      }
    }
    this.shelf[c] = val ? 1 : 0;
    this.buildGrid();
    if (val) {
      for (const r of this.robots) {
        if (!r.failed && this.dC[r.c] >= INF) {
          this.shelf[c] = 0;
          this.buildGrid();
          this.note('That would trap a robot');
          return false;
        }
      }
    }
    this.resetPlanning();
    return true;
  }

  toggleCounter(c: number): boolean {
    if (c < 0 || c >= this.M || this.voidMask[c]) return false;
    const list = this.customCounters ? [...this.customCounters] : [...this.counters];
    const idx = list.indexOf(c);
    if (idx >= 0) {
      if (list.length <= 1) {
        this.note('At least 1 counter is required');
        return false;
      }
      list.splice(idx, 1);
      this.note('Counter removed');
    } else {
      this.shelf[c] = 0;
      list.push(c);
      this.note('Counter added');
    }
    this.customCounters = list;
    this.buildGrid();
    this.resetPlanning();
    return true;
  }

  toggleVoid(c: number, makeVoid: boolean): boolean {
    if (c < 0 || c >= this.M || !!this.voidMask[c] === makeVoid) return true;
    if (makeVoid) {
      if (this.counters.includes(c) && this.counters.length <= 1) {
        this.note('Cannot carve out the last counter');
        return false;
      }
      for (const r of this.robots) {
        if (r.c === c || r.pc === c) {
          this.note('A robot is standing there');
          return false;
        }
      }
      this.shelf[c] = 0;
    }
    this.voidMask[c] = makeVoid ? 1 : 0;
    this.buildGrid();
    if (makeVoid) {
      for (const r of this.robots) {
        if (!r.failed && this.dC[r.c] >= INF) {
          this.voidMask[c] = 0;
          this.buildGrid();
          this.note('Carving that cell would trap a robot');
          return false;
        }
      }
    }
    this.resetPlanning();
    return true;
  }

  failRobotAt(c: number): boolean {
    // Find robot on clicked cell or within 1-cell radius
    let target = this.robots.find((r) => r.c === c);
    if (!target) {
      const cx = c % this.N;
      const cy = (c / this.N) | 0;
      target = this.robots.find((r) => Math.abs((r.c % this.N) - cx) + Math.abs(((r.c / this.N) | 0) - cy) <= 1);
    }
    if (!target) {
      this.note('Click directly on a robot to fail/repair it');
      return false;
    }

    if (target.failed) {
      target.failed = false;
      target.phase = 'toSlot';
      this.buildGrid();
      this.resetPlanning();
      this.note(`Robot R${target.id} repaired & returned to fleet`);
      return true;
    }

    // Fail robot & safely transfer package ownership (zero duplicates)
    target.failed = true;
    target.phase = 'failed';
    target.path = null;
    const rescuedOrder = target.order;
    const wasCarrying = target.item;
    if (target.cnt >= 0) this.cLoad[target.cnt]--;
    target.cnt = -1;
    target.item = false;
    target.order = -1;

    if (rescuedOrder >= 0 && this.shelf[rescuedOrder]) {
      this.orders.unshift(rescuedOrder);
    }

    this.buildGrid();
    this.resetPlanning();
    this.note(
      rescuedOrder >= 0
        ? `R${target.id} FAILED (${wasCarrying ? 'carrying' : 'en route'}) — order safely reassigned!`
        : `R${target.id} FAILED — fleet rerouting around stalled unit`
    );
    return true;
  }

  repairAllRobots() {
    let count = 0;
    for (const r of this.robots) {
      if (r.failed) {
        r.failed = false;
        r.phase = 'toSlot';
        count++;
      }
    }
    if (count > 0) {
      this.buildGrid();
      this.resetPlanning();
      this.note(`Repaired ${count} robot(s)`);
    }
  }

  injectHazard(type: 'fire' | 'obstacle', c: number, radius = 1) {
    if (c < 0 || c >= this.M || this.voidMask[c]) return;
    this.hazards.push({
      id: `hz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      c,
      x: c % this.N,
      y: (c / this.N) | 0,
      radius,
    });
    this.buildGrid();
    this.resetPlanning();
    this.note(type === 'fire' ? 'Fire sensor alert! Fleet rerouting' : 'Dynamic obstacle injected');
  }

  clearHazards() {
    this.hazards = [];
    this.buildGrid();
    this.resetPlanning();
  }

  orderShelf(c: number) {
    if (c >= 0 && c < this.M && this.shelf[c] && this.pickup[c] >= 0) {
      this.orders.push(c);
    }
  }

  orderRandom() {
    if (this.shelfList.length) {
      this.orderShelf(this.shelfList[(Math.random() * this.shelfList.length) | 0]);
    }
  }

  clearShelves() {
    this.shelf.fill(0);
    this.buildGrid();
    this.resetPlanning();
  }

  restoreDefaultShelves() {
    this.shelf.fill(0);
    this.defaultShelves();
    this.buildGrid();
    if (this.robots.some((r) => !r.failed && (this.dC[r.c] >= INF || this.shelf[r.c]))) {
      this.newWorld(this.robots.length, this.N, false);
    } else {
      this.resetPlanning();
    }
  }

  private free(c: number, t: number, id: number, soft: boolean): boolean {
    const i = (t & 255) * this.M + c;
    if (this.resT[i] === t && this.resI[i] !== id) return false;
    const o = this.permO[c];
    if (o >= 0 && o !== id && t >= this.permF[c]) {
      if (!soft) return false;
      const q = this.robots[o];
      if (!q || q.failed || q.phase !== 'idle' || q.path) return false;
    }
    return true;
  }

  private plan(r: InternalRobot, goal: number, dwell: number, soft: boolean): number[] | null {
    this.lastEx = 0;
    this.lastBlockers.length = 0;
    const d = this.distF(goal);
    const s = r.c;
    const t0 = this.tick;
    const id = r.id;
    const { N, M, walk, seen, par, lastRes, edT, edTo } = this;
    if (d[s] >= INF) return null;

    const maxDt = Math.min(H - dwell - 3, 2 * d[s] + 50);
    const LIM = 5000;
    this.stamp++;
    this.hn = 0;
    seen[s] = this.stamp;
    par[s] = -1;
    this.hpush(d[s] * 4096, s);
    let ex = 0;

    while (this.hn) {
      const k = this.hpop();
      const dt = (k / M) | 0;
      const c = k - dt * M;
      const t = t0 + dt;

      if (c === goal && t > lastRes[c]) {
        let ok = true;
        for (let q = 1; q <= dwell; q++) {
          if (!this.free(c, t + q, id, soft)) { ok = false; break; }
        }
        if (ok) {
          this.lastEx = ex;
          const p: number[] = [];
          let q = k;
          while (q !== -1) {
            p.push(q % M);
            q = par[q];
          }
          p.reverse();
          for (let z = 0; z < dwell; z++) p.push(goal);
          if (soft) {
            for (let i = 0; i < p.length; i++) {
              const o = this.permO[p[i]];
              if (o >= 0 && o !== id && t0 + i >= this.permF[p[i]] && !this.lastBlockers.includes(o)) {
                this.lastBlockers.push(o);
              }
            }
          }
          return p;
        }
      }

      if (++ex > LIM || dt >= maxDt) continue;
      const x = c % N;
      const nt = t + 1;
      const ndt = dt + 1;
      const base = ndt * M;

      for (let m = 0; m < 5; m++) {
        let n = c;
        if (m === 1) { if (x === 0) continue; n = c - 1; }
        else if (m === 2) { if (x === N - 1) continue; n = c + 1; }
        else if (m === 3) { if (c < N) continue; n = c - N; }
        else if (m === 4) { if (c >= M - N) continue; n = c + N; }

        if (!walk[n]) continue;
        const nk = base + n;
        if (seen[nk] === this.stamp) continue;
        if (!this.free(n, nt, id, soft)) continue;
        if (m) {
          const ei = (t & 255) * M + n;
          if (edT[ei] === t && edTo[ei] === c) continue;
        }
        seen[nk] = this.stamp;
        par[nk] = k;
        this.hpush((ndt + d[n]) * 4096 - ndt, nk);
      }
    }
    this.lastEx = ex;
    return null;
  }

  private reservePath(id: number, p: number[], t0: number) {
    const { M, resT, resI, lastRes, edT, edTo } = this;
    for (let k = 0; k < p.length; k++) {
      const t = t0 + k;
      const c = p[k];
      const i = (t & 255) * M + c;
      resT[i] = t;
      resI[i] = id;
      if (lastRes[c] < t) lastRes[c] = t;
      if (k && p[k - 1] !== c) {
        const e = ((t - 1) & 255) * M + p[k - 1];
        edT[e] = t - 1;
        edTo[e] = c;
      }
    }
    const l = p[p.length - 1];
    this.permO[l] = id;
    this.permF[l] = t0 + p.length - 1;
  }

  private dwellOf(r: InternalRobot): number {
    return r.detour >= 0 ? 0 : (r.phase === 'toPick' || r.phase === 'toCounter') ? 2 : 0;
  }

  private arrive(r: InternalRobot) {
    r.path = null;
    if (r.detour >= 0) {
      r.detour = -1;
      r.need = true;
      r.retry = 0;
      return;
    }
    if (r.phase === 'toPick') {
      this.pickBy[r.goal] = -1;
      r.item = true;
      r.phase = 'toCounter';
      this.pickCounter(r);
      r.need = true;
      r.retry = 0;
      r.fails = 0;
    } else if (r.phase === 'toCounter') {
      this.done++;
      if (r.cnt >= 0) this.cLoad[r.cnt]--;
      r.cnt = -1;
      r.item = false;
      r.order = -1;
      r.phase = 'toSlot';
      this.pickSlot(r);
      r.need = true;
      r.retry = 0;
      r.fails = 0;
    } else if (r.phase === 'toSlot') {
      r.phase = 'idle';
    }
  }

  private dispatch() {
    if (!this.orders.length) return;
    const idle: InternalRobot[] = [];
    for (const r of this.robots) if (!r.failed && r.phase === 'idle' && !r.path) idle.push(r);
    if (!idle.length) return;

    const keep: number[] = [];
    let n = 0;
    for (const sc of this.orders) {
      if (!this.shelf[sc] || this.pickup[sc] < 0) continue;
      const pk = this.pickup[sc];
      if (!idle.length || n >= 24 || this.pickBy[pk] >= 0) {
        keep.push(sc);
        continue;
      }
      const d = this.distF(pk);
      let bi = -1;
      let bd = INF;
      for (let i = 0; i < idle.length; i++) {
        const v = d[idle[i].c];
        if (v < bd) { bd = v; bi = i; }
      }
      if (bi < 0) {
        keep.push(sc);
        continue;
      }
      const r = idle.splice(bi, 1)[0];
      n++;
      if (r.slot >= 0 && this.claim[r.slot] === r.id) this.claim[r.slot] = -1;
      r.slot = -1;
      r.phase = 'toPick';
      r.order = sc;
      r.goal = pk;
      r.need = true;
      r.retry = 0;
      r.fails = 0;
      this.pickBy[pk] = r.id;
    }
    this.orders = keep;
  }

  private fillSlots() {
    if (this.tick % 3) return;
    let given = 0;
    for (const s of this.activeRest) {
      if (given >= 2) break;
      if (this.claim[s] >= 0 || this.permO[s] >= 0) continue;
      const d = this.distF(s);
      let best: InternalRobot | null = null;
      let bd = INF;
      for (const r of this.robots) {
        if (!r.failed && r.phase === 'idle' && !r.path && (r.slot < 0 || this.slotKind[r.slot] !== 1)) {
          const v = d[r.c];
          if (v < bd) { bd = v; best = r; }
        }
      }
      if (!best) break;
      if (best.slot >= 0 && this.claim[best.slot] === best.id) this.claim[best.slot] = -1;
      best.slot = s;
      this.claim[s] = best.id;
      best.phase = 'toSlot';
      best.goal = s;
      best.need = true;
      best.retry = 0;
      best.fails = 0;
      given++;
    }
  }

  private evict(b: InternalRobot, avoid: Set<number>): boolean {
    if (b.failed) return false;
    const d = this.distF(b.c);
    let best = -1;
    let bd = INF;
    const consider = (arr: number[]) => {
      for (const s of arr) {
        if (this.claim[s] >= 0 || this.permO[s] >= 0 || avoid.has(s)) continue;
        if (d[s] < bd) { bd = d[s]; best = s; }
      }
    };
    consider(this.parkCells);
    if (best < 0) consider(this.restCells);
    if (best < 0) return false;
    if (b.slot >= 0 && this.claim[b.slot] === b.id) this.claim[b.slot] = -1;
    b.slot = best;
    this.claim[best] = b.id;
    b.phase = 'toSlot';
    b.goal = best;
    b.need = true;
    b.retry = 0;
    b.fails = 0;
    return true;
  }

  private makeDetour(r: InternalRobot) {
    const d = this.distF(r.c);
    for (let i = 0; i < 30; i++) {
      const c = (Math.random() * this.M) | 0;
      if (this.walk[c] && d[c] > 0 && d[c] <= 6 && this.permO[c] < 0 && this.lastRes[c] < this.tick && this.claim[c] < 0) {
        r.detour = c;
        r.fails = 0;
        r.retry = this.tick;
        return;
      }
    }
  }

  step() {
    const T0 = performance.now();
    this.tick++;

    for (const r of this.robots) {
      r.pc = r.c;
      if (!r.failed && r.path) {
        const k = this.tick - r.t0;
        r.c = r.path[k < r.path.length ? k : r.path.length - 1];
      }
      // Track waiting time when an active robot stands still
      if (!r.failed && r.phase !== 'idle' && r.c === r.pc) {
        this.waitTicks++;
      }
    }

    this.occStamp++;
    for (const r of this.robots) {
      if (this.occT[r.c] === this.occStamp) this.cols++;
      this.occT[r.c] = this.occStamp;
      this.occI[r.c] = r.id;
    }
    for (const r of this.robots) {
      if (r.pc !== r.c && this.occT[r.pc] === this.occStamp) {
        const q = this.robots[this.occI[r.pc]];
        if (q && q.id !== r.id && q.pc === r.c && q.c === r.pc && r.id < q.id) this.cols++;
      }
    }

    for (const r of this.robots) {
      if (!r.failed && r.path && this.tick - r.t0 >= r.path.length - 1) this.arrive(r);
    }

    if (this.shelfList.length) {
      let n = Math.floor(this.rate / 10);
      if (Math.random() < this.rate / 10 - n) n++;
      for (let i = 0; i < n && this.orders.length < 300; i++) {
        this.orderShelf(this.shelfList[(Math.random() * this.shelfList.length) | 0]);
      }
    }

    this.dispatch();
    this.fillSlots();

    const need: InternalRobot[] = [];
    for (const r of this.robots) if (!r.failed && r.need && this.tick >= r.retry) need.push(r);
    for (let i = need.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = need[i];
      need[i] = need[j];
      need[j] = t;
    }

    let budget = EXP_BUDGET;
    for (let i = 0; i < need.length && budget > 0; i++) {
      const r = need[i];
      const g = r.detour >= 0 ? r.detour : r.goal;
      const c = r.c;
      const dw = this.dwellOf(r);
      if (this.permO[c] === r.id) this.permO[c] = -1;
      const p = this.plan(r, g, dw, false);
      budget -= this.lastEx + 8;

      if (p) {
        this.reservePath(r.id, p, this.tick);
        r.path = p;
        r.t0 = this.tick;
        r.need = false;
        r.fails = 0;
        continue;
      }

      this.permO[c] = r.id;
      this.permF[c] = this.tick;
      r.fails++;
      r.retry = this.tick + 1 + ((Math.random() * 2) | 0) + Math.min(r.fails, 4);

      if (r.fails >= 2 && r.fails < 6 && budget > 0 && r.phase !== 'idle') {
        this.permO[c] = -1;
        const sp = this.plan(r, g, dw, true);
        budget -= this.lastEx + 8;
        if (sp && this.lastBlockers.length) {
          const avoid = new Set(sp);
          for (const o of this.lastBlockers) {
            const b = this.robots[o];
            if (b && this.evict(b, avoid)) need.push(b);
          }
          r.retry = this.tick + 1;
        }
        this.permO[c] = r.id;
        this.permF[c] = this.tick;
      } else if (r.fails >= 6 && r.detour < 0 && r.phase !== 'idle') {
        this.makeDetour(r);
      }
    }

    this.planMs = this.planMs * 0.9 + (performance.now() - T0) * 0.1;
  }

  newWorld(n: number, size: number, keepShelves: boolean, voidCells: [number, number][] = []) {
    const old = keepShelves && size === this.N ? this.shelf.slice() : null;
    this.customCounters = null;
    this.alloc(size);
    for (const [vx, vy] of voidCells) {
      if (vx >= 0 && vx < size && vy >= 0 && vy < size) {
        this.voidMask[vy * size + vx] = 1;
      }
    }
    if (old) this.shelf.set(old);
    else this.defaultShelves();

    this.tick = 0;
    this.done = 0;
    this.cols = 0;
    this.waitTicks = 0;
    this.orders = [];
    this.hazards = [];
    this.robots = [];
    this.activeCount = Math.max(0, n - this.reserve);
    this.buildGrid();

    const slots = [
      ...this.activeRest,
      ...this.parkCells,
      ...this.restCells.filter((c) => !this.activeRest.includes(c)),
    ];
    if (n > slots.length) {
      this.note(`Only ${slots.length} parking/rest slots fit - starting with ${slots.length} robots`);
      n = slots.length;
    }
    for (let i = 0; i < n; i++) {
      const c = slots[i];
      const r = this.makeRobot(i, c);
      r.slot = c;
      this.claim[c] = i;
      this.permO[c] = i;
      this.permF[c] = 0;
      this.robots.push(r);
    }
  }

  addRobots(k: number) {
    if (k < 0) {
      for (let i = 0; i < -k; i++) {
        const r = this.robots[this.robots.length - 1];
        if (this.robots.length > 1 && r.phase === 'idle' && !r.path) {
          if (r.slot >= 0 && this.claim[r.slot] === r.id) this.claim[r.slot] = -1;
          this.permO[r.c] = -1;
          this.robots.pop();
        } else {
          this.note('Last robot is busy - try again in a moment');
          break;
        }
      }
      return;
    }

    for (let i = 0; i < k; i++) {
      let cell = -1;
      for (const arr of [this.parkCells, this.restCells]) {
        for (const c of arr) {
          if (this.claim[c] < 0 && this.permO[c] < 0 && this.lastRes[c] < this.tick) {
            cell = c;
            break;
          }
        }
        if (cell >= 0) break;
      }
      if (cell < 0) {
        this.note('No free parking slots left');
        break;
      }
      const r = this.makeRobot(this.robots.length, cell);
      r.slot = cell;
      this.claim[cell] = r.id;
      this.permO[cell] = r.id;
      this.permF[cell] = this.tick;
      this.robots.push(r);
    }
  }

  snapshot(): MapfSnapshot {
    const hotShelves = new Set<number>(this.orders);
    let failedCount = 0;
    const visualRobots: MapfRobot[] = this.robots.map((r) => {
      if (r.failed) failedCount++;
      if (r.order >= 0 && r.phase === 'toPick') hotShelves.add(r.order);
      let phase: RobotPhase = r.phase;
      if (
        !r.failed &&
        r.path &&
        (r.phase === 'toPick' || r.phase === 'toCounter') &&
        this.tick - r.t0 >= r.path.length - 1 - 2
      ) {
        phase = r.phase === 'toPick' ? 'picking' : 'dropping';
      }
      return {
        id: r.id,
        c: r.c,
        pc: r.pc,
        phase,
        item: r.item,
        failed: r.failed,
        order: r.order,
        slot: r.slot,
        goal: r.goal,
        cnt: r.cnt,
      };
    });

    return {
      N: this.N,
      version: this.version,
      tick: this.tick,
      done: this.done,
      cols: this.cols,
      waitTicks: this.waitTicks,
      failedCount,
      planMs: this.planMs,
      pendingOrders: this.orders.length,
      inProgress: this.robots.filter((r) => !r.failed && r.order >= 0 && (r.phase === 'toPick' || r.phase === 'toCounter')).length,
      shelfList: this.shelfList,
      counters: this.counters,
      restCells: this.restCells,
      activeRest: this.activeRest,
      parkCells: this.parkCells,
      voidMask: this.voidMask,
      walkMask: this.walk,
      shelfMask: this.shelf,
      hotShelves,
      hazards: this.hazards,
      robots: visualRobots,
      notice: Date.now() - this.noticeAt < 3500 ? this.notice : '',
    };
  }
}