// A worker thread of party-team.js buildPool: plays its share of the pool's party rounds and posts each one back.
import { parentPort, workerData } from 'node:worker_threads';
import { teamShift } from './party-team.js';

for (const j of workerData) {
  try { parentPort.postMessage({ key: j.key, flow: j.flow, i: j.i, x: teamShift(j) }); } catch (e) { parentPort.postMessage({ err: String(e?.stack ?? e).slice(0, 400) }); break; }
}
