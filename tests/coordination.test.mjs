import test from 'node:test';
import assert from 'node:assert/strict';

test('Reservation table prevents vertex collision at same (x, y, t)', () => {
  const reservations = new Set();
  const reserve = (x, y, t) => {
    const key = `${x},${y},${t}`;
    if (reservations.has(key)) return false;
    reservations.add(key);
    return true;
  };

  assert.equal(reserve(5, 5, 1), true);
  assert.equal(reserve(5, 5, 1), false); // Collision blocked
  assert.equal(reserve(5, 5, 2), true);  // Next tick allowed
});

test('Edge-swap prevention blocks head-on corridor collisions', () => {
  const edges = new Set();
  const reserveEdge = (x1, y1, x2, y2, t) => {
    const reverse = `${x2},${y2}->${x1},${y1}@${t}`;
    if (edges.has(reverse)) return false;
    edges.add(`${x1},${y1}->${x2},${y2}@${t}`);
    return true;
  };

  assert.equal(reserveEdge(1, 2, 2, 2, 3), true);
  assert.equal(reserveEdge(2, 2, 1, 2, 3), false); // Head-on swap blocked
});

test('Failed robot order reassignment prevents duplicate ownership', () => {
  const orders = [{ id: 'ORD-1', assignedTo: 'R1', status: 'carrying' }];
  const failRobot = (robotId) => {
    for (const o of orders) {
      if (o.assignedTo === robotId) {
        o.assignedTo = null;
        o.status = 'pending';
      }
    }
  };

  failRobot('R1');
  assert.equal(orders[0].assignedTo, null);
  assert.equal(orders[0].status, 'pending');
});
