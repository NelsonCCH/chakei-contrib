// Co-op smoke test of a deployed build: two raw room sockets on the preview, the owner starts a free-play
// shift, and we watch the room's referee on the real Cloudflare runtime: tick cadence (4 Hz), keyframes (every 2 s) and
// the welcome to a phone that says hello. No browser, no sound. Usage:
//   node scripts/smoke-remote-room.mjs https://<your-worker>.<your-subdomain>.workers.dev [seconds=20]
import { roomSocket, sleep } from '../tests/helpers/server.js';

const url = process.argv[2], secs = Number(process.argv[3] ?? 20);
if (!url || /\/\/chakei\./.test(url)) throw new Error('give the preview URL (never the live chakei)');
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * 32)]).join('');
const tag = Math.random().toString(36).slice(2, 8);
const BUILD = (await (await fetch(url + '/api/config')).json()).build ?? '';
const meta = { host: 'h', hostName: '測試', hostStation: 'waiter', slot: 'lunch', diff: 'rookie', state: 'lobby', level: 'estate', round: 0, at: Date.now() };

const h = roomSocket(url, code, 'smkh' + tag, 'host');
await h.opened; await h.wait(m => m.t === 'hello');
h.send({ t: 'meta', meta });
const a = roomSocket(url, code, 'smka' + tag, 'client');
await a.wait(m => m.t === 'hello');
a.send({ t: 'seat', seat: { name: '阿明', station: 'bar' } });
await h.wait(m => m.t === 'seats' && m.seats['smka' + tag], 5000);
h.send({ t: 'start', level: '', lv: null, slot: 'lunch', diff: 'pro', extra: [], port: { rank: 2, rlv: {}, names: {} } });
await a.wait(m => m.t === 'meta' && m.meta.state === 'playing', 5000);
const t0 = Date.now(), seen = [];
a.ws.addEventListener('message', e => {
  if (typeof e.data !== 'string' || e.data === 'pong') return;
  const m = JSON.parse(e.data);
  if (m.t === 'env' && m.e.from === 'ref') seen.push({ k: m.e.b.k, at: Date.now() - t0 });
});
a.send({ t: 'env', e: { p: 1, room: code, from: 'x', round: 1, seq: 0, at: 0, b: { k: 'hello', proto: 1, build: BUILD, caps: { z: false, cs: true, ptt: false }, role: 'player', name: '阿明', player: 'smka' + tag, resume: null } } });
await sleep(secs * 1000);
const ticks = seen.filter(x => x.k === 'tick'), keys = seen.filter(x => x.k === 'keyframe'), welcome = seen.some(x => x.k === 'welcome');
const gaps = ticks.slice(1).map((x, i) => x.at - (ticks[i]?.at ?? 0)).sort((p, q) => p - q);
const q = f => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * f))] ?? NaN;
console.log(`room ${code}, ${secs} s: ${ticks.length} ticks (${(ticks.length / secs).toFixed(2)}/s; gap median ${q(.5)} ms, p95 ${q(.95)} ms, max ${q(1)} ms), ${keyframesLine(keys)}, welcome ${welcome}`);
function keyframesLine(k) { return `${k.length} keyframes (${(k.length / secs).toFixed(2)}/s)`; }
[h, a].forEach(s => s.close());
const ok = welcome && ticks.length / secs > 3.5 && keys.length / secs > .35 && q(.95) < 600;
console.log(ok ? 'remote room smoke ok' : 'remote room smoke FAILED');
process.exit(ok ? 0 : 1);
