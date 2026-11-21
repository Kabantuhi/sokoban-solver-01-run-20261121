// Sokoban solver: push-optimal, room by room.
//
// Every level this competition draws is a hallway with 1-4 rooms off it, each
// room holding 3-4 boxes and as many goals, and no box can ever leave its room
// (a box pushed through a door into the hallway can never be pushed back), so a
// level's push-optimum is the sum of its rooms' optima. This program splits a
// level into its rooms and solves each room push-optimally with A* over
// macro-pushes (one push = one box moved one step, with the walk between pushes
// filled in by BFS), then stitches the rooms together in scan order.
//
// The A* heuristic is the min-cost assignment of boxes to goals by shortest
// walking distance (BFS over floor, boxes ignored). One push moves one box one
// square, so the assignment cost changes by at most 1 per push: the heuristic
// is admissible and consistent, so closed-set A* returns a push-optimal
// solution. Deadlocks pruned: a box on a non-live square (no push, ignoring the
// other boxes, can bring it to a goal) and a frozen 2x2 block of walls and
// boxes with a box off its goal. Deterministic throughout: fixed direction
// order, fixed heap tie-breaking, fixed expansion budget counted in states
// (never the clock), no randomness, no Date.now().
//
// Plain JavaScript in a .ts file: Node 22 strips types natively, and plain JS
// runs unchanged on every Node 22. Run: node main.ts, reading
// $MAKEFUN_INPUT_DIR (default /input) and writing $MAKEFUN_OUTPUT_DIR
// (default /output); one solution.txt of u/d/l/r moves per instance id.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Directions: [dx, dy, walk letter, push letter]. Fixed order everywhere.
const DIRS = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

// Most states one room search may generate before it gives up (work, never
// the clock). Rooms here hold at most 4 boxes in a 6x6 slot, and the
// reference search keeps a room only when it solves within 250,000 states;
// A* with the assignment heuristic expands a subset of a breadth-first
// search's states, so this budget is generous.
const MAX_STATES_PER_ROOM = 1_000_000;

/** Parse XSB text into { w, h, wall, goals, boxes, player }. */
function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals = [];
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

/** Squares from which a box alone can be pushed onto some goal (pulled back from the goals over open floor). */
function liveSquares(level) {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each part left that holds
 * a box is a room. Null when some part holds more or fewer boxes than goals,
 * or a box starts in the hallway: then the level is no set of rooms.
 */
function roomsOf(level) {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i] + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (first direction first on ties). */
function walkTo(level, occupied, from, to) {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w, from, moves) {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The push-optimal solution of `level` ({pushes, moves}), searching at most
 * `maxStates` states, or null when the search gives up (or the level has no
 * solution). A* over macro-pushes; a state is the sorted boxes plus the
 * player's reachable region, named by its lowest square.
 */
function solvePushOptimal(level, maxStates = MAX_STATES_PER_ROOM) {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const live = liveSquares(level);
  const startBoxes = level.boxes.slice().sort((a, b) => a - b);
  // More boxes than goals can never be solved (every box needs a distinct
  // goal to end on). Fewer boxes than goals is fine: the win condition is
  // every box on a goal, not every goal filled. The assignment heuristic
  // below handles the rectangular case (each box to a distinct goal).
  if (startBoxes.length > goals.length) return null;
  if (startBoxes.some((b) => !live[b])) return null;
  const solved = (bs) => bs.every((b) => goalSet[b]);
  if (solved(startBoxes)) return { pushes: 0, moves: '' };

  // Walking distances from each goal over floor (walls only, boxes ignored).
  const n = startBoxes.length;
  const dist = goals.map((g) => {
    const d = new Int32Array(size).fill(-1);
    const q = [g];
    d[g] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      for (const [dx, dy] of DIRS) {
        const nq = p + dy * w + dx;
        if (!wall[nq] && d[nq] < 0) {
          d[nq] = d[p] + 1;
          q.push(nq);
        }
      }
    }
    return d;
  });

  // Min-cost assignment of boxes to goals (brute force: at most 4 boxes).
  // Rectangular: each box takes a distinct goal; goals may outnumber boxes.
  // Memoised by box configuration: the heuristic depends on boxes alone.
  const hCache = new Map();
  function heuristic(bs) {
    const k = bs.join(',');
    const cached = hCache.get(k);
    if (cached !== undefined) return cached;
    let best = Infinity;
    const used = new Array(goals.length).fill(false);
    (function rec(i, cost) {
      if (cost >= best) return;
      if (i === n) {
        best = cost;
        return;
      }
      for (let j = 0; j < goals.length; j++) {
        if (used[j]) continue;
        const dd = dist[j][bs[i]];
        if (dd < 0) continue;
        used[j] = true;
        rec(i + 1, cost + dd);
        used[j] = false;
      }
    })(0, 0);
    hCache.set(k, best);
    return best;
  }

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size); // region marks of the state being expanded
  const mark = new Int32Array(size); // region marks of a successor state
  const stack = new Int32Array(size);
  let stamp = 0;

  // Flood fill from `from` with `occ` as obstacles; mark the region in `arr`
  // with a fresh stamp and return [lowest square, stamp].
  function region(occ, from, arr) {
    const s = ++stamp;
    let low = from;
    let cnt = 0;
    stack[cnt++] = from;
    arr[from] = s;
    while (cnt > 0) {
      const p = stack[--cnt];
      if (p < low) low = p;
      let q = p - w;
      if (!wall[q] && !occ[q] && arr[q] !== s) { arr[q] = s; stack[cnt++] = q; }
      q = p + w;
      if (!wall[q] && !occ[q] && arr[q] !== s) { arr[q] = s; stack[cnt++] = q; }
      q = p - 1;
      if (!wall[q] && !occ[q] && arr[q] !== s) { arr[q] = s; stack[cnt++] = q; }
      q = p + 1;
      if (!wall[q] && !occ[q] && arr[q] !== s) { arr[q] = s; stack[cnt++] = q; }
    }
    return [low, s];
  }

  // Whether the box just pushed to `t` sits in a frozen 2x2 block of walls
  // and boxes with a box off its goal.
  function frozenBlock(occ, t) {
    for (const a of [t, t - 1, t - w, t - w - 1]) {
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      if (!(wall[a] || occ[a]) || !(wall[b] || occ[b]) || !(wall[c] || occ[c]) || !(wall[d] || occ[d])) continue;
      if ((occ[a] && !goalSet[a]) || (occ[b] && !goalSet[b]) || (occ[c] && !goalSet[c]) || (occ[d] && !goalSet[d])) return true;
    }
    return false;
  }

  const keyOf = (bs, low) => `${low}|${bs.join(',')}`;

  // Binary heap on [f, g desc, seq asc, state]: smallest f first, deeper
  // states first on ties, insertion order last. Deterministic.
  const heap = [];
  const heapLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
  function heapPush(e) {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i], heap[p])) break;
      const t = heap[i]; heap[i] = heap[p]; heap[p] = t;
      i = p;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1], heap[c])) c++;
        if (!heapLess(heap[c], heap[i])) break;
        const t = heap[i]; heap[i] = heap[c]; heap[c] = t;
        i = c;
      }
    }
    return top;
  }

  // The states: boxes, player square, g (pushes), parent, the push that made
  // them (box from -> to, direction index), and their region key.
  const sBoxes = [startBoxes];
  const sPlayer = [level.player];
  const sG = [0];
  const parent = [-1];
  const pushMade = [null];
  const best = new Map();
  for (const b of startBoxes) occupied[b] = 1;
  const [startLow] = region(occupied, level.player, seen);
  const sKey = [keyOf(startBoxes, startLow)];
  best.set(sKey[0], 0);
  const h0 = heuristic(startBoxes);
  if (h0 === Infinity) return null;
  let seq = 0;
  heapPush([h0, 0, seq++, 0]);

  let expanded = 0;
  let found = -1;
  while (heap.length > 0) {
    const [, g, , s] = heapPop();
    if (best.get(sKey[s]) !== s) continue; // stale heap entry: a better path to this state was recorded
    const bs = sBoxes[s];
    if (solved(bs)) {
      found = s;
      break;
    }
    if (++expanded > maxStates) return null;
    for (const b of bs) occupied[b] = 1;
    const [, here] = region(occupied, sPlayer[s], seen);
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi];
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di];
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(occupied, t);
        let key = null;
        let next = null;
        let nextLow = 0;
        if (!frozen) {
          next = bs.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          [nextLow] = region(occupied, b, mark);
          key = keyOf(next, nextLow);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || key === null) continue;
        const prev = best.get(key);
        if (prev !== undefined && sG[prev] <= g + 1) continue;
        if (sBoxes.length >= maxStates) {
          for (const x of bs) occupied[x] = 0;
          return null;
        }
        const h = heuristic(next);
        if (h === Infinity) continue;
        const idx = sBoxes.length;
        best.set(key, idx);
        sBoxes.push(next);
        sPlayer.push(b);
        sG.push(g + 1);
        sKey.push(key);
        parent.push(s);
        pushMade.push({ from: b, to: t, dir: di });
        heapPush([g + 1 + h, g + 1, seq++, idx]);
      }
    }
    for (const x of bs) occupied[x] = 0;
  }
  if (found < 0) return null;

  // Reconstruct: walk to each push's square, then push.
  const path = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = startBoxes;
  for (const s of path) {
    const nextBoxes = sBoxes[s];
    const { from, to, dir } = pushMade[s];
    const d = to - from;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += DIRS[dir][3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * The level solved room by room: each room's push-optimal solution in turn,
 * the other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. {pushes,
 * moves}, or null when a room's search gives up, or the level is no set of
 * rooms and the search over the whole level gives up.
 */
function solveByRooms(level, maxStates = MAX_STATES_PER_ROOM) {
  const rooms = roomsOf(level);
  if (rooms === null) return solvePushOptimal(level, maxStates);
  let player = level.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solvedRoom = solvePushOptimal(sub, maxStates);
    if (solvedRoom === null) return null;
    pushes += solvedRoom.pushes;
    moves += solvedRoom.moves;
    player = endOf(level.w, player, solvedRoom.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** Solve one level's XSB text; an empty string when it cannot be solved. */
function solve(text) {
  const level = parseLevel(text);
  if (level.player < 0 || level.boxes.length === 0) return '';
  const solved = solveByRooms(level);
  return solved === null ? '' : solved.moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
