/**
 * chakei Worker: serves the game (site/) and its whole backend.
 *
 *   /api/config              which login methods this deployment offers
 *   /api/auth/google         Google ID token -> our session token
 *   /api/auth/dev            fake login for local dev / staging tests (only when DEV_AUTH=1)
 *   /api/me                  who the session token belongs to
 *   /api/save                GET / PUT the signed-in player's SHOP save
 *   /api/daily/<day>         GET top 20 of a daily challenge per seat; POST my score
 *   /api/stats               anonymous usage counters (replaces the old Firestore stats/<day>)
 *   /api/ptlog               POST a batch of the playtest timing log (preview only: PLAYTEST="1")
 *   /api/room/<CODE>         WebSocket into a co-op room (one Durable Object per room)
 *
 * Replaces the Firebase backend of the original game. Accounts are Google only; the
 * session token is our own HMAC-signed "uid.expiry", so no database read is needed to check it.
 *
 * TypeScript port of the original game's worker/index.js; scripts/build.mjs compiles it back to
 * worker/index.js, which wrangler bundles. Rules used in this port:
 * - Request bodies and room messages are `unknown` and read with `field(v, k)`, which behaves exactly like the JS `v.k`:
 *   it throws the same TypeError on null / undefined (the old code then answered 500 from the catch in `fetch`) and
 *   gives undefined for a missing key. No check was added where the JS had none.
 * - `must(x)` only where the JS dereferenced x, so it throws exactly where the JS threw.
 */
import { DurableObject } from 'cloudflare:workers';
import { freshCore, type RoomCore, type PartyOut } from './room-core.js';

/** Bindings and vars (wrangler.jsonc) plus the secrets (`wrangler secret put`, `.dev.vars`). */
interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ROOMS: DurableObjectNamespace<Room>;
  GOOGLE_CLIENT_ID?: string;
  DEV_AUTH?: string;
  STATS?: string;
  /** '1' on a playtest preview Worker only: the page shows its 試玩 pace panel. Never on live. */
  PLAYTEST?: string;
  SESSION_SECRET?: string;
  /** Tests only (tests/helpers/server.js): a JWKS JSON trusted as Google's keys. */
  GOOGLE_JWKS_OVERRIDE?: string;
  /** Tests only (tests/helpers/server.js): '1' lets a room's phones ask its referee for test operations (`dbg`). */
  ROOM_DEBUG?: string;
}

/* D1 row shapes (migrations/0001_init.sql). */
interface UserRow { uid: string; name: string; provider: string }
/** `ver` (migrations/0002_save_version.sql): bumped by every write, 0 for a save written before versions existed. */
interface SaveRow { shop: string; updated: number; ver: number }
interface DailyRow { uid: string; name: string; revenue: number; stars: number; station: string; slot: string; at: number }

const MAX_SAVE_BYTES = 256 * 1024;
const SESSION_DAYS = 180;
const DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const ROOM_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const STAT_KEY_RE = /^[a-z0-9_]{1,30}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // Only our own page may use the backend: a copy of the game hosted elsewhere gets no saves, leaderboard or
    // co-op rooms, and cannot spend our free-plan allowance. Browsers always send Origin on cross-site fetches and on
    // WebSocket upgrades; requests without one (same-origin GETs, scripts) pass, a script can fake it anyway.
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'origin' }, 403);
    try {
      return await api(request, env, url);
    } catch (err) {
      return json({ error: 'server', detail: errDetail(err) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname, m = request.method;

  const room = p.match(/^\/api\/room\/([^/]+)$/);
  if (room) return connectRoom(request, env, url, room[1] ?? '');   // group 1 always matches

  if (p === '/api/config' && m === 'GET') {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || '', devAuth: env.DEV_AUTH === '1', stats: env.STATS === '1', playtest: env.PLAYTEST === '1' });
  }
  if (p === '/api/auth/google' && m === 'POST') return authGoogle(request, env);
  if (p === '/api/auth/dev' && m === 'POST') return authDev(request, env);
  if (p === '/api/me' && m === 'GET') {
    const uid = await sessionUid(request, env);
    if (!uid) return json({ error: 'auth' }, 401);
    const u = await env.DB.prepare('SELECT uid, name, provider FROM users WHERE uid = ?1').bind(uid).first<UserRow>();
    return u ? json({ user: u }) : json({ error: 'auth' }, 401);
  }

  if (p === '/api/save') {
    const uid = await sessionUid(request, env);
    if (!uid) return json({ error: 'auth' }, 401);
    if (m === 'GET') {
      const row = await env.DB.prepare('SELECT shop, updated, ver FROM saves WHERE uid = ?1').bind(uid).first<SaveRow>();
      // No row: no `ver` either, which a client reads as version 0 (the same answer an old Worker gives).
      return json(row ? { shop: parseJson(row.shop), updated: row.updated, ver: row.ver } : { shop: null });
    }
    if (m === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_SAVE_BYTES) return json({ error: 'too_large' }, 413);
      let data: unknown;
      try { data = parseJson(body); } catch { return json({ error: 'not_json' }, 400); }
      if (!data) return json({ error: 'bad_shop' }, 400);
      const shop = field(data, 'shop');
      if (typeof shop !== 'object' || Array.isArray(shop) || shop === null) return json({ error: 'bad_shop' }, 400);
      // `ver` (the version the client read) makes the write a compare-and-set: it lands only if the save is still at
      // that version, else 409 stale and the client reads, merges and retries (src/cloud.ts). No `ver` = a client from
      // before versions (cached by the service worker): written unconditionally, as before. Every write bumps the version.
      const ver = field(data, 'ver');
      if (ver !== undefined && !(typeof ver === 'number' && Number.isInteger(ver) && ver >= 0)) return json({ error: 'bad_ver' }, 400);
      const now = Date.now();
      const done = await env.DB.prepare(`INSERT INTO saves (uid, shop, updated, ver) VALUES (?1, ?2, ?3, 1)
        ON CONFLICT(uid) DO UPDATE SET shop = ?2, updated = ?3, ver = saves.ver + 1 WHERE ?4 IS NULL OR saves.ver = ?4 RETURNING ver`)
        .bind(uid, JSON.stringify(shop), now, ver ?? null).first<{ ver: number }>();
      if (!done) {
        const cur = await env.DB.prepare('SELECT ver FROM saves WHERE uid = ?1').bind(uid).first<{ ver: number }>();
        return json({ error: 'stale', ver: cur ? cur.ver : 0 }, 409);
      }
      return json({ ok: true, updated: now, ver: done.ver });
    }
  }

  const daily = p.match(/^\/api\/daily\/([0-9-]+)$/);
  if (daily) {
    const day = daily[1] ?? '';   // group 1 always matches
    if (!DAY_RE.test(day)) return json({ error: 'bad_day' }, 400);
    if (m === 'GET') {
      const uid = await sessionUid(request, env);
      // Ranked per seat: takings, a seat's own takings and the sink's points do not compare, so each seat the day
      // was played at has its own top 20. A row stored without a seat ('') is its own group here; the page counts it as
      // the seat that day's draw gives for the four (ui/cloud.ts lbGroups). Rows of a retired seat (洗碗 'wash', since
      // removed) are left out of the board; they stay in the table.
      const rs = await env.DB.prepare(`SELECT uid, name, revenue, stars, station, slot, at FROM (SELECT uid, name, revenue, stars, station, slot, at,
        ROW_NUMBER() OVER (PARTITION BY station ORDER BY revenue DESC, at ASC) AS rk FROM daily_scores WHERE day = ?1 AND station <> 'wash') WHERE rk <= 20
        ORDER BY station, revenue DESC, at ASC`).bind(day).all<DailyRow>();
      return json({ day, rows: rs.results.map(r => ({ name: r.name, revenue: r.revenue, stars: r.stars, station: r.station, slot: r.slot, me: !!uid && r.uid === uid })) });
    }
    if (m === 'POST') {
      const uid = await sessionUid(request, env);
      if (!uid) return json({ error: 'auth' }, 401);
      if (!nearToday(day)) return json({ error: 'stale_day' }, 400);
      let d: unknown;
      try { d = await request.json(); } catch { return json({ error: 'not_json' }, 400); }
      const revenue = clampInt(field(d, 'revenue'), 0, 1e6), stars = clampInt(field(d, 'stars'), 0, 3);
      const name = cleanName(field(d, 'name')) || '伙記';
      const station = str(field(d, 'station') || '').slice(0, 12), slot = str(field(d, 'slot') || '').slice(0, 12);
      // Keep each player's best revenue for the day; a worse run never overwrites it.
      await env.DB.prepare(`INSERT INTO daily_scores (day, uid, name, revenue, stars, station, slot, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(day, uid) DO UPDATE SET name = ?3, revenue = ?4, stars = ?5, station = ?6, slot = ?7, at = ?8 WHERE ?4 > daily_scores.revenue`)
        .bind(day, uid, name, revenue, stars, station, slot, Date.now()).run();
      return json({ ok: true });
    }
  }

  if (p === '/api/stats' && m === 'POST') {
    let d: unknown;
    try { d = await request.json(); } catch { return json({ error: 'not_json' }, 400); }
    if (!d || !DAY_RE.test(String(field(d, 'day')))) return json({ error: 'bad_stats' }, 400);
    const e = field(d, 'e');
    if (!e || typeof e !== 'object') return json({ error: 'bad_stats' }, 400);
    const entries = Object.entries(e).filter((kv): kv is [string, number] => {
      const k = kv[0], n: unknown = kv[1];
      return STAT_KEY_RE.test(k) && typeof n === 'number' && Number.isFinite(n) && n > 0;
    }).slice(0, 60);
    if (entries.length) {
      await env.DB.batch(entries.map(([k, n]) => env.DB.prepare('INSERT INTO stats (day, k, n) VALUES (?1, ?2, ?3) ON CONFLICT(day, k) DO UPDATE SET n = n + ?3')
        .bind(field(d, 'day'), k, Math.min(1000, Math.floor(n)))));
    }
    return json({ ok: true, n: entries.length });
  }

  // The preview's playtest timing log. Only a Worker with PLAYTEST="1" (a playtest preview) takes it; the
  // live Worker answers 404 as for any unknown path and never writes the table.
  if (p === '/api/ptlog' && m === 'POST' && env.PLAYTEST === '1') return ptLog(request, env);

  return json({ error: 'not_found' }, 404);
}

/* ===================== playtest timing log (preview only) ===================== */

const PTLOG_MAX_BYTES = 128 * 1024, PTLOG_MAX_ROWS = 400;
const isPtRow = (r: unknown): boolean => typeof r === 'object' && r !== null && !Array.isArray(r)
  && typeof field(r, 'i') === 'string' && typeof field(r, 't') === 'number' && typeof field(r, 'e') === 'string' && typeof field(r, 's') === 'string';
/** One batch of the page's log (src/playtest/log.ts) -> one row of playtest_log; a (dev, b) seen before is ignored. */
async function ptLog(request: Request, env: Env): Promise<Response> {
  const text = await request.text();
  if (text.length > PTLOG_MAX_BYTES) return json({ error: 'too_large' }, 413);
  let d: unknown;
  try { d = parseJson(text); } catch { return json({ error: 'not_json' }, 400); }
  if (typeof d !== 'object' || d === null) return json({ error: 'bad_log' }, 400);
  const dev = field(d, 'dev'), b = field(d, 'b'), ev = field(d, 'ev'), ver = field(d, 'ver'), lost = field(d, 'lost');
  if (typeof dev !== 'string' || !/^[0-9a-f]{16}$/.test(dev) || typeof b !== 'number' || !Number.isInteger(b) || b < 1) return json({ error: 'bad_log' }, 400);
  if (!Array.isArray(ev) || !ev.length || ev.length > PTLOG_MAX_ROWS || !ev.every(isPtRow)) return json({ error: 'bad_log' }, 400);
  await env.DB.prepare('INSERT OR IGNORE INTO playtest_log (dev, b, at, ver, n, lost, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(dev, b, Date.now(), typeof ver === 'string' ? ver.slice(0, 20) : '', ev.length, clampInt(lost, 0, 1e6), JSON.stringify(ev)).run();
  return json({ ok: true });
}

/* ===================== auth ===================== */

async function authGoogle(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'google_not_configured' }, 503);
  let d: unknown;
  try { d = await request.json(); } catch { return json({ error: 'not_json' }, 400); }
  const claims = await verifyGoogleIdToken(str(field(d, 'credential') || ''), env);
  if (!claims) return json({ error: 'bad_token' }, 401);
  const uid = 'g:' + String(claims.sub);
  const name = cleanName(claims.given_name || firstWord(claims.name || '')) || '伙記';
  return login(env, uid, name, 'google', claims.email || '');
}

/** `s.split(/\s+/)[0]` on a value the JS assumed is a string (a non-string threw a TypeError there, and still does). */
function firstWord(s: unknown): unknown {
  if (typeof s !== 'string') throw new TypeError('(claims.name || "").split is not a function');
  return s.split(/\s+/)[0];
}

async function authDev(request: Request, env: Env): Promise<Response> {
  if (env.DEV_AUTH !== '1') return json({ error: 'not_found' }, 404);
  let d: unknown = {};
  try { d = await request.json(); } catch { /* no body: default name */ }
  // Same name -> same account, so a test (or a person on staging) can "sign in on another device".
  const name = cleanName(field(d, 'name')) || '測試員';
  const uid = 'dev:' + (await sha256hex('dev-user:' + name)).slice(0, 20);
  return login(env, uid, name, 'dev', '');
}

async function login(env: Env, uid: string, name: string, provider: string, email: unknown): Promise<Response> {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO users (uid, name, provider, email, created, last_login) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(uid) DO UPDATE SET last_login = ?5, email = ?4`).bind(uid, name, provider, email, now).run();
  const u = await env.DB.prepare('SELECT uid, name, provider FROM users WHERE uid = ?1').bind(uid).first<UserRow>();
  return json({ token: await signSession(env, uid, now + SESSION_DAYS * 86400e3), user: u });
}

/** The claims of a verified Google ID token that the login uses (signed by Google, so trusted as they are). */
interface GoogleClaims { sub: unknown; given_name: unknown; name: unknown; email: unknown }

/** Verifies a Google Sign-In ID token (RS256) against Google's published keys. */
async function verifyGoogleIdToken(token: string, env: Env): Promise<GoogleClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p0 = '', p1 = '', p2 = ''] = parts;   // three parts, checked above
  let header: unknown, claims: unknown;
  try {
    header = parseJson(b64urlText(p0));
    claims = parseJson(b64urlText(p1));
  } catch { return null; }
  if (field(header, 'alg') !== 'RS256' || !field(header, 'kid')) return null;
  const jwks = await googleKeys(env);
  if (!Array.isArray(jwks)) throw new TypeError('jwks.find is not a function');
  const list: unknown[] = jwks;
  const found = list.find(k => field(k, 'kid') === field(header, 'kid'));
  if (!found) return null;
  const key = await crypto.subtle.importKey('jwk', toJwk(found), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(p2), new TextEncoder().encode(p0 + '.' + p1));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const iss = field(claims, 'iss');
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return null;
  if (field(claims, 'aud') !== env.GOOGLE_CLIENT_ID) return null;
  // Number(x) > y is the JS `x > y` for every JSON value (both convert x with ToNumber).
  if (!(Number(field(claims, 'exp')) > now - 60)) return null;
  if (!field(claims, 'sub')) return null;
  return { sub: field(claims, 'sub'), given_name: field(claims, 'given_name'), name: field(claims, 'name'), email: field(claims, 'email') };
}

/**
 * A key from the JWKS as WebCrypto's JsonWebKey: the public RSA fields Google publishes. A key with a field of the
 * wrong type throws a TypeError, as importKey did on it in the JS (both answer 500).
 */
function toJwk(k: unknown): JsonWebKey {
  const str = (f: string): string | undefined => {
    const v = field(k, f);
    if (v === undefined || typeof v === 'string') return v;
    throw new TypeError(`JWK field ${f} is not a string`);
  };
  const kty = str('kty'), keyOps = field(k, 'key_ops'), ext = field(k, 'ext');
  if (kty === undefined) throw new TypeError('JWK without kty');
  const jwk: JsonWebKey = { kty };
  for (const f of ['use', 'alg', 'n', 'e'] as const) { const v = str(f); if (v !== undefined) jwk[f] = v; }
  if (keyOps !== undefined) {
    if (!Array.isArray(keyOps)) throw new TypeError('JWK key_ops is not an array');
    const ops: unknown[] = keyOps;
    jwk.key_ops = ops.map(String);
  }
  if (ext !== undefined) {
    if (typeof ext !== 'boolean') throw new TypeError('JWK ext is not a boolean');
    jwk.ext = ext;
  }
  return jwk;
}

let jwksCache: { at: number; keys: unknown } = { at: 0, keys: [] };
async function googleKeys(env: Env): Promise<unknown> {
  // Tests sign their own tokens; the override only exists in .dev.vars, never in production.
  if (env.GOOGLE_JWKS_OVERRIDE) return field(parseJson(env.GOOGLE_JWKS_OVERRIDE), 'keys');
  if (Date.now() - jwksCache.at < 3600e3 && field(jwksCache.keys, 'length')) return jwksCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: field(j, 'keys') || [] };
  return jwksCache.keys;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET not set');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signSession(env: Env, uid: string, exp: number): Promise<string> {
  const body = b64urlFromText(JSON.stringify({ uid, exp }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(body));
  return body + '.' + b64urlFromBytes(new Uint8Array(sig));
}
/**
 * The uid in a valid session token. The payload is signed with our secret and always holds a string uid
 * (signSession), so the typeof check only narrows the type.
 */
async function sessionUid(request: Request, env: Env): Promise<string | null> {
  const h = request.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  let ok: boolean;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlBytes(sig), new TextEncoder().encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const payload = parseJson(b64urlText(body));
    const uid = field(payload, 'uid'), exp = field(payload, 'exp');
    return Number(exp) > Date.now() && typeof uid === 'string' ? uid : null;
  } catch { return null; }
}

/* ===================== co-op rooms ===================== */

function connectRoom(request: Request, env: Env, url: URL, code: string): Response | Promise<Response> {
  if (!ROOM_RE.test(code)) return json({ error: 'bad_room' }, 400);
  if (!/^[a-z0-9]{4,16}$/.test(url.searchParams.get('id') || '')) return json({ error: 'bad_id' }, 400);
  const role = url.searchParams.get('role');
  if (role !== 'host' && role !== 'client' && role !== 'viewer') return json({ error: 'bad_role' }, 400);
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected_websocket' }, 426, { Upgrade: 'websocket' });
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
}

// 8 players plus 2 viewers (a TV showing the shop, REFEREE_DESIGN 3.8): a viewer never takes a player's place.
const ROOM_MAX_PLAYERS = 8, ROOM_MAX_VIEWERS = 2;
const ROOM_MAX_SOCKETS = ROOM_MAX_PLAYERS + ROOM_MAX_VIEWERS;
const MAX_MSG = { host: 512 * 1024, client: 16 * 1024, viewer: 16 * 1024 };
// The room owner (the "host": the phone that opened the room) only sets up the lobby and starts each shift; the shift
// itself runs in this object. Owner dropped: wait this long before the lobby duty moves to a seated player.
const HOST_GRACE_MS = 6000;
const SEAT_GRACE_MS = 15000;  // client dropped: keep its seat this long so a reconnect resumes it
/** While a shift runs the referee keeps its last state in storage this often, to carry on after a restart. */
const SHIFT_SAVE_MS = 5000;
/** After the books close the referee keeps ticking this long (the closed keyframe goes out), then sleeps. */
const SHIFT_LINGER_MS = 6000;
// Every phone pings every 2 s (answered by the auto-response, which records the time). A socket silent for
// SILENT_MS is treated as closed even if no close ever arrives (lift, iOS suspending Safari): checked every HEARTBEAT_MS
// while any socket is open.
const SILENT_MS = 10000;
const HEARTBEAT_MS = 5000;

/*
 * Push-to-talk floor. The room owns the floor, never a phone: one
 * player at a time holds it, for at most FLOOR_MAX_MS, and must say floorHold every second; a holder that goes quiet
 * for FLOOR_SILENT_MS, closes, drops, goes silent, leaves its seat, or is the old host when another is promoted loses
 * it. Audio frames (binary) are relayed only from the holder, only for its current turn, within a size and rate budget.
 * Frame layout (src/ptt/codec.ts writes it): byte 0 = AUDIO_MAGIC, bytes 1-4 = turn (uint32 LE), bytes 5-6 = frame
 * number (uint16 LE), then 8 kHz mu-law samples.
 */
const FLOOR_MAX_MS = 12000;
const FLOOR_SILENT_MS = 2500;
/** A player may ask for the floor at most FLOOR_REQ_MAX times per FLOOR_REQ_WINDOW_MS (press spam). */
const FLOOR_REQ_MAX = 6;
const FLOOR_REQ_WINDOW_MS = 3000;
const AUDIO_MAGIC = 0xa1;
const AUDIO_HEAD = 7;
/** 160 ms of 8 kHz mu-law plus the header; the client sends 80 ms frames. */
const AUDIO_MAX_BYTES = AUDIO_HEAD + 1280;
/** Budget per turn: 8000 bytes/s of samples plus 25% slack, and a 1.5 s burst for a frame queue flushed after a hitch. */
const AUDIO_BYTES_PER_MS = 10;
const AUDIO_BURST_BYTES = 12000;
const AUDIO_FRAMES_PER_MS = 1 / 40;
const AUDIO_BURST_FRAMES = 20;

/** Why the floor became free (sent with the `floor` message that says so). */
type FloorWhy = 'release' | 'limit' | 'silent' | 'gone' | 'leave' | 'host';
/** The floor while someone holds it. `since`/`until` are Date.now() times; the counters are this turn's audio. */
interface Floor { holder: string; name: string; turn: number; since: number; until: number; lastHold: number; bytes: number; frames: number }

/** viewer: a screen that only watches (never seated, never promoted, sends only `env` hellos to the referee). */
type Role = 'host' | 'client' | 'viewer';
/** What each socket carries (serializeAttachment). Only this file writes it. `mute`: send this phone no audio. */
interface Attachment { id?: string; role?: Role; at?: number; dead?: boolean; mute?: boolean }
/** A seated client, as stored under 'seats' and sent in hello / seats / promote. */
interface Seat { id?: string; name: string; station: string; at: number; z: boolean }
/**
 * The room's storage: 'meta' is what the host sent (relayed as is) with this room's own `state` and `round` once a shift
 * has started here; the rest is written by this file. Also 'code' (the room code, for the envelopes), 'round' (the
 * last shift started) and 'shift' (the running shift's settings and last keyframe).
 */
interface RoomState { meta: unknown; seats: Record<string, Seat>; host: string | null; away: Record<string, number>; hostAway: number }

/** The socket's attachment (`ws.deserializeAttachment() || {}` in the JS). */
function attachmentOf(ws: WebSocket): Attachment {
  const v: unknown = ws.deserializeAttachment();
  if (!v || typeof v !== 'object') return {};
  const id = field(v, 'id'), role = field(v, 'role'), at = field(v, 'at'), dead = field(v, 'dead'), mute = field(v, 'mute');
  const a: Attachment = {};
  if (typeof id === 'string') a.id = id;
  if (role === 'host' || role === 'client' || role === 'viewer') a.role = role;
  if (typeof at === 'number') a.at = at;
  if (typeof dead === 'boolean') a.dead = dead;
  if (typeof mute === 'boolean') a.mute = mute;
  return a;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSeat = (v: unknown): v is Seat => isRecord(v) && (v.id === undefined || typeof v.id === 'string')
  && typeof v.name === 'string' && typeof v.station === 'string' && typeof v.at === 'number' && typeof v.z === 'boolean';
function seatsFrom(v: unknown): Record<string, Seat> {
  const out: Record<string, Seat> = {};
  if (!isRecord(v)) return out;
  for (const [k, s] of Object.entries(v)) if (isSeat(s)) out[k] = s;
  return out;
}
/** The lobby's seats a saved shift was started with (seat -> player). */
function seatedFrom(v: Record<string, unknown>): Record<string, { player: string; name: string }> {
  const out: Record<string, { player: string; name: string }> = {};
  for (const [k, s] of Object.entries(v)) if (isRecord(s) && typeof s.player === 'string' && typeof s.name === 'string') out[k] = { player: s.player, name: s.name };
  return out;
}
function awayFrom(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, t] of Object.entries(v)) if (typeof t === 'number') out[k] = t;
  return out;
}

/**
 * One co-op room. The room runs the shift's referee itself, the same core
 * code a solo phone runs (worker/room-core.js, built from src/core/coop/room.ts), so no phone is special: anyone can lock
 * the screen or leave and the shift goes on, from anywhere. Every phone, the owner's too, sends its envelopes ("env") to
 * the referee here, with `from` stamped by this object; the referee's go to every phone or to one. While a shift runs a
 * timer wakes the referee ROOM_WAKE_MS apart (it plays the wall time since the last wake in the shop's fixed steps), and
 * the shift is saved every SHIFT_SAVE_MS so a restarted object carries on from it. The room keeps meta (lobby info) and
 * seats in storage and the referee's last keyframe in memory, so a late joiner or a reconnecting phone gets them at once.
 * The owner (the "host", who opened the room) sets up the lobby and starts each shift; if the owner vanishes that duty
 * moves to the longest-seated player, and the shift does not notice.
 *
 * Wire format (JSON text). Client -> room: meta (host only), start (host only: the shift's settings), seat, env, close
 * (host only), ping; dbg (tests only, ROOM_DEBUG). Room -> client: hello {you, host, meta, seats, floor}, meta, seats,
 * env, promote, host {id}, closed, error, dbg.
 * Push-to-talk (any player): floorReq {name}, floorHold {turn}, floorRelease {turn}, pttMute {on}, and binary audio
 * frames from the holder. Room -> client: floor {holder, name, turn, left, why?} to everyone on every change (and to a
 * phone whose floorHold is stale), floorNo {why: 'busy' | 'slow', holder, name, turn, left} to a refused request, and the
 * holder's audio frames as they came.
 */
export class Room extends DurableObject<Env> {
  /** player id -> last message time (memory only; pings are timed by the auto-response) */
  heard: Map<string | undefined, number>;
  /** the referee's last keyframe envelope (REFEREE_DESIGN 4.6), replayed to phones that connect */
  lastKey: string | null = null;
  /** This room's own copy of the core: made on the first shift, kept while the object lives. */
  core: RoomCore | null = null;
  /** The room code (the envelopes carry it); read from the URL on the first connect and kept in storage. */
  code = '';
  /** The referee's timer while a shift runs (null: none), when the shift was last saved, when its books closed (0: not yet). */
  timer: ReturnType<typeof setInterval> | null = null;
  savedAt = 0;
  closedAt = 0;
  /** The push-to-talk floor (null = free). Also in storage ('floor'), so a restarted object still frees it. */
  floor: Floor | null = null;
  /** The last turn number handed out (a new turn is always larger, even after a restart: it starts from the clock). */
  lastTurn = 0;
  /** player id -> times of its recent floor requests (memory only; press-spam limit) */
  floorReqs = new Map<string, number[]>();
  /** The party night's clock: runs only while a screen has one (the vote's change window, the countdown). */
  partyTimer: ReturnType<typeof setInterval> | null = null;
  partyAt = 0;
  /** The night as last sent to the phones (only a change is sent again). */
  partySent = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.heard = new Map();
    void ctx.blockConcurrencyWhile(async () => {
      // A floor held when the object was evicted: kept, with a fresh keep-alive deadline. Its holder either keeps
      // saying floorHold (and keeps talking) or the alarm frees it FLOOR_SILENT_MS from now and tells everyone.
      const f: unknown = await ctx.storage.get('floor');
      if (isRecord(f) && typeof f.holder === 'string' && typeof f.name === 'string' && typeof f.turn === 'number'
        && typeof f.since === 'number' && typeof f.until === 'number') {
        this.floor = { holder: f.holder, name: f.name, turn: f.turn, since: f.since, until: f.until, lastHold: Date.now(), bytes: 0, frames: 0 };
        this.lastTurn = f.turn;
      }
      const code: unknown = await ctx.storage.get('code');
      if (typeof code === 'string') this.code = code;
      // A shift that was running when the object was evicted or redeployed: the referee carries on from its last save
      // (phones resend what that save does not have, as after a host change).
      const saved: unknown = await ctx.storage.get('shift');
      if (this.code && isRecord(saved) && isRecord(saved.key) && typeof saved.round === 'number' && typeof saved.seed === 'number' && isRecord(saved.sh)) {
        try {
          const core = this.core = freshCore();
          const sh = core.roomShiftOf(saved.sh, isRecord(saved.sh.seated) ? seatedFrom(saved.sh.seated) : {});
          if (sh) { core.roomRestore(this.refOpts(saved.round, saved.seed), sh, saved.key, saved.drove, saved.tally); this.wake(); }
        } catch { this.core = null; /* a save from an older build: the shift is lost, the room stays */ }
      }
      // a party night carries on from its last state, beside the shift
      const night: unknown = await ctx.storage.get('party');
      if (this.code && night !== undefined) {
        const core = this.core ?? freshCore();
        if (core.partyLoad(night)) { this.core = core; this.partyWake(); }
      }
    });
  }

  /* ---- the referee ---- */
  /** How the referee is started: this room, its messages out through the sockets, the round and its seed. */
  refOpts(round: number, seed: number): { room: string; send: (e: { to?: string; b: { k: string } }) => void; now: number; round: number; seed: number } {
    return { room: this.code, now: Date.now(), round, seed, send: e => {
      const text = JSON.stringify({ t: 'env', e });
      if (typeof e.to === 'string') { const w = this.socketOf(e.to); if (w) this.send(w, text); return; }
      if (e.b.k === 'keyframe') this.lastKey = text;
      this.broadcast(text);
    } };
  }
  /** Starts the referee's timer (if it is not running). */
  wake(): void {
    if (this.timer || !this.core) return;
    this.closedAt = 0;
    this.timer = setInterval(() => { void this.beat(); }, this.core.ROOM_WAKE_MS);
  }
  sleep(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  /** One wake of the referee: play the time since the last, send what is due; save now and then; sleep once it is over. */
  async beat(): Promise<void> {
    const core = this.core; if (!core) { this.sleep(); return; }
    const now = Date.now();
    core.roomAdvance(now);
    const st = core.roomStatus();
    if (!st) { this.sleep(); return; }
    if (st.closed && !this.closedAt) { this.closedAt = now; await this.saveShift(); await this.shiftClosed(); }
    if (this.closedAt && now - this.closedAt >= SHIFT_LINGER_MS) { this.sleep(); return; }
    if (!st.closed && now - this.savedAt >= SHIFT_SAVE_MS) await this.saveShift();
  }
  async saveShift(): Promise<void> {
    const s = this.core?.roomSave();
    this.savedAt = Date.now();
    if (s) await this.ctx.storage.put('shift', s);
  }
  /** A shift is being played here right now (its books not yet closed). */
  shiftLive(): boolean { const s = this.core?.roomStatus(); return !!s && !s.closed; }
  /**
   * The lobby info with the fields this room owns: once a shift has started here, which round it was and
   * whether one is being played now (`playing` only until its books close, then `lobby` again, so the lobby shows and a
   * late joiner is not told a shift runs); `party` while a party night is open. The rest is the owner's, as sent.
   */
  async metaWith(mm: unknown): Promise<unknown> {
    if (!isRecord(mm)) return mm;
    const round: unknown = await this.ctx.storage.get('round'), out: Record<string, unknown> = { ...mm };
    if (typeof round === 'number') { out.round = round; out.state = this.shiftLive() ? 'playing' : 'lobby'; }
    if (this.core?.partyNight()) out.party = true; else Reflect.deleteProperty(out, 'party');
    return out;
  }
  /** Stores and sends the lobby info again after the room changed one of its own fields. */
  async pushMeta(): Promise<void> {
    const m: unknown = await this.ctx.storage.get('meta');
    if (!isRecord(m)) return;
    const meta = await this.metaWith(m);
    await this.ctx.storage.put('meta', meta);
    this.broadcast({ t: 'meta', meta });
  }
  /** The bell rang and the books are closed: the lobby is back; a party round's report goes to the night. */
  async shiftClosed(): Promise<void> {
    await this.pushMeta();
    if (this.core?.partyNight()) await this.partyOuts(this.core.partyResult(), null);
  }
  /** The owner's start message: a new shift with the lobby's seats (the owner's own from meta), round one up. */
  async startShift(msg: unknown): Promise<void> {
    if (this.core?.partyNight()) return;   // a party night starts its own rounds (partyOuts)
    const st = await this.load();
    const seated: Record<string, { player: string; name: string }> = {};
    for (const [k, s] of Object.entries(st.seats)) if (s.station) seated[s.station] = { player: s.id ?? k, name: s.name };
    const m = st.meta, hostSeat = isRecord(m) ? (typeof m.hostX === 'string' && m.hostX) || (typeof m.hostStation === 'string' ? m.hostStation : '') : '';
    if (st.host && hostSeat && !seated[hostSeat]) seated[hostSeat] = { player: st.host, name: isRecord(m) && typeof m.hostName === 'string' ? m.hostName : '' };
    const core = this.core ?? (this.core = freshCore());
    const sh = core.roomShiftOf(msg, seated);
    if (sh) await this.startWith(core, sh);
  }
  /** Starts a shift with these settings, round one up (an owner's start, or a party night's round). */
  async startWith(core: RoomCore, sh: ReturnType<RoomCore['partyShift']>): Promise<void> {
    const prev: unknown = await this.ctx.storage.get('round');
    const round = (typeof prev === 'number' ? prev : 0) + 1;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
    this.sleep(); this.lastKey = null;
    core.roomStart(this.refOpts(round, seed), sh);
    await this.ctx.storage.put('round', round);
    await this.pushMeta();
    await this.saveShift();
    this.wake();
  }
  /** The room is gone (closed on purpose, or nobody left): the shift and any party night stop, their saves go. */
  endRoom(): void { this.sleep(); this.partySleep(); this.core = null; this.lastKey = null; this.floor = null; this.partySent = ''; }

  /* ---- the party night ---- */
  /**
   * Acts on what the night asked for, then stores the night and sends it to every phone if it changed: a refusal goes to
   * the sender only (`ws`); a new host becomes the room's owner; a seat handed to the computer mid-round is released (a
   * player taking a seat claims it from their own phone); a round start starts the round's shift.
   */
  async partyOuts(outs: PartyOut[], ws: WebSocket | null): Promise<void> {
    const core = this.core; if (!core) return;
    let plan: unknown = null;
    for (const o of outs) {
      if (o.k === 'reject') { if (ws) this.send(ws, { t: 'party', why: o.why }); }
      else if (o.k === 'host') await this.setOwner(o.player);
      else if (o.k === 'drive') core.roomDrive(o.seat, o.player);
      else if (o.k === 'roundStart') plan = o.plan;
    }
    await this.partySend();
    if (plan !== null) await this.startWith(core, core.partyShift(plan));
    this.partyWake();
  }
  /** Stores the night and sends it to everyone, if it changed since it was last sent. */
  async partySend(): Promise<void> {
    const night = this.core?.partyNight() ?? null, text = JSON.stringify({ t: 'party', night });
    if (text === this.partySent) return;
    this.partySent = text;
    if (night) await this.ctx.storage.put('party', night); else await this.ctx.storage.delete('party');
    this.broadcast(text);
  }
  /** The night's clock runs while its screen has one (4 Hz: the phones show the seconds left). */
  partyWake(): void {
    if (this.partyTimer || !this.core?.partyTimed()) return;
    this.partyAt = Date.now();
    this.partyTimer = setInterval(() => { void this.partyBeat(); }, 250);
  }
  partySleep(): void { if (this.partyTimer) clearInterval(this.partyTimer); this.partyTimer = null; }
  async partyBeat(): Promise<void> {
    const core = this.core, now = Date.now();
    if (!core?.partyTimed()) { this.partySleep(); return; }
    const dt = Math.max(0, (now - this.partyAt) / 1000); this.partyAt = now;
    await this.partyOuts(core.partyTick(dt), null);
    if (!core.partyTimed()) this.partySleep();
  }
  /**
   * The night's host is the room's owner: lobby duty follows the night's own rule (a seated player only). null:
   * nobody seated is here, the room stays without an owner until someone sits (the night names them then).
   */
  async setOwner(id: string | null): Promise<void> {
    const st = await this.load();
    if (id === null || id === st.host) return;
    const ws = this.socketOf(id); if (!ws) return;
    const old = this.socketOf(st.host);
    if (old) old.serializeAttachment({ ...attachmentOf(old), role: 'client' });
    ws.serializeAttachment({ ...attachmentOf(ws), role: 'host' });
    await this.ctx.storage.put({ host: id, hostAway: 0 });
    this.send(ws, { t: 'promote', station: '', seats: st.seats, meta: st.meta });
    this.broadcast({ t: 'host', id }, ws);
  }
  /** Someone in the night (present) by this id. */
  inNight(id: string | undefined): boolean { return !!id && !!this.core?.partyNight()?.players.some(p => p.id === id && p.present); }

  /** The floor as phones see it: who holds it and for how much longer (null = free). */
  floorState(): { holder: string; name: string; turn: number; left: number } | null {
    const f = this.floor;
    return f ? { holder: f.holder, name: f.name, turn: f.turn, left: Math.max(0, f.until - Date.now()) } : null;
  }
  floorMsg(why?: FloorWhy): object {
    const s = this.floorState();
    return s ? { t: 'floor', ...s } : { t: 'floor', holder: null, name: '', turn: this.lastTurn, left: 0, ...(why ? { why } : {}) };
  }

  async floorReq(ws: WebSocket, a: Attachment, name: unknown): Promise<void> {
    const id = a.id;
    if (!id) return;
    const now = Date.now();
    const recent = (this.floorReqs.get(id) || []).filter(x => now - x < FLOOR_REQ_WINDOW_MS);
    const f = this.floor;
    const who = f ? { holder: f.holder, name: f.name, turn: f.turn, left: Math.max(0, f.until - now) } : { holder: null, name: '', turn: this.lastTurn, left: 0 };
    if (recent.length >= FLOOR_REQ_MAX) { this.floorReqs.set(id, recent); this.send(ws, { t: 'floorNo', why: 'slow', ...who }); return; }
    recent.push(now);
    this.floorReqs.set(id, recent);
    if (f && f.holder === id) { f.lastHold = now; this.send(ws, this.floorMsg()); return; }   // asked again: still yours
    if (f) { this.send(ws, { t: 'floorNo', why: 'busy', ...who }); return; }
    const turn = Math.max(this.lastTurn + 1, now % 2 ** 32) >>> 0;
    this.lastTurn = turn;
    const nm = cleanName(name) || '伙記';
    this.floor = { holder: id, name: nm, turn, since: now, until: now + FLOOR_MAX_MS, lastHold: now, bytes: 0, frames: 0 };
    this.broadcast(this.floorMsg());
    await this.ctx.storage.put('floor', { holder: id, name: nm, turn, since: now, until: now + FLOOR_MAX_MS });
    await this.scheduleAlarm(await this.load());
  }

  /** Frees the floor (if held) and tells everyone why. */
  async freeFloor(why: FloorWhy): Promise<void> {
    if (!this.floor) return;
    this.floor = null;
    this.broadcast(this.floorMsg(why));
    await this.ctx.storage.delete('floor');
  }

  /** An audio frame: relayed to everyone else only if it is the holder's, for its current turn, within budget. */
  audio(ws: WebSocket, a: Attachment, buf: ArrayBuffer): void {
    const f = this.floor, now = Date.now();
    if (!f || a.id !== f.holder || now >= f.until) return;
    if (buf.byteLength <= AUDIO_HEAD || buf.byteLength > AUDIO_MAX_BYTES) return;
    const v = new DataView(buf);
    if (v.getUint8(0) !== AUDIO_MAGIC || v.getUint32(1, true) !== f.turn) return;
    const el = now - f.since;
    if (f.bytes + buf.byteLength > AUDIO_BURST_BYTES + el * AUDIO_BYTES_PER_MS || f.frames + 1 > AUDIO_BURST_FRAMES + el * AUDIO_FRAMES_PER_MS) return;
    f.bytes += buf.byteLength; f.frames++;
    this.heard.set(a.id, now);
    for (const w of this.ctx.getWebSockets()) {
      if (w === ws || w.readyState !== WebSocket.OPEN) continue;
      const b = attachmentOf(w);
      if (b.dead || b.mute) continue;
      try { w.send(buf); } catch { /* closing socket */ }
    }
  }

  /** When this socket was last heard from: its last ping, its last message, or its connect time. */
  lastHeard(ws: WebSocket, a: Attachment): number {
    let ping = 0;
    try { const t = this.ctx.getWebSocketAutoResponseTimestamp(ws); ping = t ? t.getTime() : 0; } catch { /* closed socket */ }
    return Math.max(ping, this.heard.get(a.id) || 0, a.at || 0);
  }

  async load(): Promise<RoomState> {
    const s = await this.ctx.storage.get(['meta', 'seats', 'host', 'away', 'hostAway']);
    const host = s.get('host'), hostAway = s.get('hostAway');
    return {
      meta: s.get('meta') || null,
      seats: seatsFrom(s.get('seats')),
      host: typeof host === 'string' && host ? host : null,
      away: awayFrom(s.get('away')),
      hostAway: typeof hostAway === 'number' && hostAway ? hostAway : 0,
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.searchParams.get('id'), role = url.searchParams.get('role');
    // connectRoom (the only way in) already checked both; this only narrows the types.
    if (id === null || (role !== 'host' && role !== 'client' && role !== 'viewer')) return json({ error: 'bad_id' }, 400);
    const st = await this.load();
    if (!this.code) { this.code = url.pathname.split('/').pop() ?? ''; await this.ctx.storage.put('code', this.code); }
    const open = this.ctx.getWebSockets().filter(w => w.readyState === WebSocket.OPEN && !attachmentOf(w).dead);
    const viewers = open.filter(w => attachmentOf(w).role === 'viewer').length;
    if (open.length >= ROOM_MAX_SOCKETS) return json({ error: 'room_full' }, 429);
    if (role === 'viewer' ? viewers >= ROOM_MAX_VIEWERS : open.length - viewers >= ROOM_MAX_PLAYERS) return json({ error: 'room_full' }, 429);

    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    let myRole: Role = role;
    if (role === 'host') {
      if (st.host && st.host !== id && (this.socketOf(st.host) || st.hostAway)) {
        // Code collision with a live room: tell the would-be host to pick another code.
        this.ctx.acceptWebSocket(server, ['client']);
        server.serializeAttachment({ id, role: 'client', dead: true });
        server.send(JSON.stringify({ t: 'error', error: 'taken' }));
        server.close(4001, 'taken');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (st.host !== id) {
        // A fresh room (or a dead one being reused): wipe the old state.
        await this.ctx.storage.deleteAll();
        st.meta = null; st.seats = {}; st.away = {};
        this.endRoom();
        await this.ctx.storage.put('code', this.code);
      }
      st.host = id; st.hostAway = 0;
      await this.ctx.storage.put({ host: id, hostAway: 0 });
    } else if (role === 'client' && st.host === id) {
      myRole = 'host';   // the host reconnecting after a drop, or after a promotion it has not heard of yet
      st.hostAway = 0;
      await this.ctx.storage.put('hostAway', 0);
    }
    // Close an older socket of the same player (a reconnect racing the old socket's close).
    for (const w of this.ctx.getWebSockets()) {
      const a = attachmentOf(w);
      if (a.id === id) { w.serializeAttachment({ ...a, dead: true }); try { w.close(4000, 'replaced'); } catch { /* already closed */ } }
    }
    this.ctx.acceptWebSocket(server, [myRole]);
    server.serializeAttachment({ id, role: myRole, at: Date.now() });
    // The holder of the floor reconnecting: its old link is gone, so is its turn (its page released it on the drop).
    if (this.floor && this.floor.holder === id) await this.freeFloor('gone');

    if (st.away[id]) { Reflect.deleteProperty(st.away, id); await this.ctx.storage.put('away', st.away); }
    if (myRole !== 'host' && !st.meta && !st.host) {
      server.send(JSON.stringify({ t: 'error', error: 'no_room' }));
    }
    // floor: who is talking right now (null = nobody), so a phone that (re)connects mid-turn shows it at once.
    server.send(JSON.stringify({ t: 'hello', you: myRole, host: st.host, meta: st.meta, seats: st.seats, floor: this.floorState() }));
    // A (re)connecting phone gets the referee's last keyframe at once.
    if (this.lastKey) server.send(this.lastKey);
    // a party night: its state as it is now (later changes come as broadcasts)
    { const night = this.core?.partyNight(); if (night) server.send(JSON.stringify({ t: 'party', night })); }
    if (myRole === 'host') this.broadcast({ t: 'host', id }, server);
    await this.scheduleAlarm(st);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = attachmentOf(ws);
    if (a.dead) return;
    const role = a.role;
    if (typeof message !== 'string') { if (role !== 'viewer') this.audio(ws, a, message); return; }   // the only binary messages are audio frames
    const max = role ? MAX_MSG[role] : 0;
    if (message.length > max) return;
    this.heard.set(a.id, Date.now());
    let msg: unknown;
    try { msg = parseJson(message); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const t = field(msg, 't');

    // Envelopes (REFEREE_DESIGN 3): every phone's go to the referee here, with `from` stamped by this object (never
    // trusted from the phone); the referee answers through refOpts' send. No shift here yet: nothing to answer.
    if (t === 'env') {
      const e = field(msg, 'e');
      if (!isRecord(e) || !this.core) return;
      this.core.roomReceive({ ...e, from: a.id }, Date.now());
      return;
    }
    if (t === 'dbg') {
      // tests only (tests/helpers/server.js sets ROOM_DEBUG): the referee's test operations, answered to the asker
      if (this.env.ROOM_DEBUG !== '1') return;
      const res = this.core ? this.core.roomDebug(field(msg, 'd'), Date.now()) : { error: 'no shift' };
      this.send(ws, { t: 'dbg', id: field(msg, 'id'), res });
      return;
    }
    if (t === 'pttMute') { ws.serializeAttachment({ ...a, mute: field(msg, 'on') === true }); return; }
    if (role === 'viewer') return;   // a viewer only watches: no taps, seats, floor or room control
    if (t === 'floorReq') { await this.floorReq(ws, a, field(msg, 'name')); return; }
    if (t === 'floorHold' || t === 'floorRelease') {
      const f = this.floor, mine = !!f && f.holder === a.id && field(msg, 'turn') === f.turn;
      if (t === 'floorRelease') { if (mine) await this.freeFloor('release'); return; }   // an old turn's release frees nothing
      if (mine) f.lastHold = Date.now();
      else this.send(ws, this.floorMsg());   // not (or no longer) yours: say who has it, so the phone stops talking
      return;
    }
    if (t === 'pttMute') { ws.serializeAttachment({ ...a, mute: field(msg, 'on') === true }); return; }
    if (t === 'meta' && role === 'host') {
      // once a shift has started here, the room says which round it is and whether it plays, and whether a party
      // night is open: not the owner's page
      const round: unknown = await this.ctx.storage.get('round'), mm = field(msg, 'meta');
      const meta = await this.metaWith(mm), own = typeof round === 'number' || !!this.core?.partyNight();
      await this.ctx.storage.put('meta', meta);
      this.broadcast({ t: 'meta', meta }, own ? undefined : ws);
      return;
    }
    if (t === 'start' && role === 'host') { await this.startShift(msg); return; }
    // A teammate switches a 樓面 place on or off in the lobby: the owner's page decides (and says so in its meta)
    if (t === 'slot' && role === 'client') {
      const host = (await this.load()).host, w = host && host !== a.id ? this.socketOf(host) : null;
      if (w) this.send(w, { t: 'slot', seat: str(field(msg, 'seat') || '').slice(0, 12), on: field(msg, 'on') === true, from: a.id });
      return;
    }
    // a party night: the owner opens it (once) and closes it again in its lobby or after 散水; anyone in the
    // room plays it (`party`: the phone's input, stamped with who sent it)
    if (t === 'partyOpen' && role === 'host') {
      const core = this.core ?? (this.core = freshCore());
      if (core.partyNight() || this.shiftLive() || !a.id) return;
      await this.partyOuts(core.partyOpen(crypto.getRandomValues(new Uint32Array(1))[0] ?? 1, a.id, str(field(msg, 'name') || '')), ws);
      await this.pushMeta();
      return;
    }
    if (t === 'partyClose' && role === 'host') {
      const ph = this.core?.partyNight()?.phase;
      if (ph !== 'lobby' && ph !== 'done') return;
      this.core?.partyDrop(); this.partySleep();
      await this.partySend();
      await this.pushMeta();
      return;
    }
    if (t === 'party') {
      if (!this.core?.partyNight() || !a.id) return;
      await this.partyOuts(this.core.partyIn(field(msg, 'ev'), a.id), ws);
      return;
    }
    if (t === 'seat') {
      const st = await this.load();
      const seat = field(msg, 'seat');
      const me = String(a.id);   // a property key, as st.seats[a.id] was in the JS
      if (seat) {
        const want = str(field(seat, 'station') || '');
        const clash = Object.entries(st.seats).some(([k, s]) => k !== a.id && s.station === want) || (st.meta && (field(st.meta, 'hostX') || field(st.meta, 'hostStation')) === want);
        if (clash) { this.send(ws, { t: 'error', error: 'seat_taken', station: want }); return; }
        // z: the phone can unpack compressed snapshots; pages from before the flag count as "cannot", which is safe
        // a lobby seat needs a station: an empty one is no seat (and so never makes its phone the owner)
        if (!want) return;
        const s: Seat = { name: str(field(seat, 'name') || '').slice(0, 12), station: want, at: Date.now(), z: field(seat, 'z') === true };
        st.seats[me] = a.id === undefined ? s : { id: a.id, ...s };
      } else {
        Reflect.deleteProperty(st.seats, me);
        if (this.floor && this.floor.holder === a.id) await this.freeFloor('leave');
        // left the room on purpose (not a lost link): the computer takes their seats at once, and
        // they leave the party night (its seat goes to the computer, its host duty to a seated player)
        if (a.id) { this.core?.roomLeave(a.id); if (this.inNight(a.id)) await this.partyOuts(this.core?.partyLeave(a.id) ?? [], null); }
      }
      await this.ctx.storage.put('seats', st.seats);
      this.broadcast({ t: 'seats', seats: st.seats });
      // a room without an owner (the owner left and nobody was seated): the first to sit takes lobby duty
      if (seat && !this.core?.partyNight() && st.hostAway && Date.now() - st.hostAway >= HOST_GRACE_MS && !this.socketOf(st.host)) await this.promote(st);
      return;
    }
    if (t === 'close' && role === 'host') {
      this.broadcast({ t: 'closed' }, ws);
      this.endRoom();
      await this.ctx.storage.deleteAll();
      for (const w of this.ctx.getWebSockets()) { try { w.close(1000, 'closed'); } catch { /* already closed */ } }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const a = attachmentOf(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'closed'); } catch { /* already closed */ }
    if (a.dead) return;
    await this.gone(a, Date.now());
  }

  /** A player's socket is gone (closed, or silent since `since`): start the host / seat grace period from then. */
  async gone(a: Attachment, since: number): Promise<void> {
    if (this.floor && this.floor.holder === a.id) await this.freeFloor('gone');
    const st = await this.load();
    if (!st.host && !st.meta) return;
    if (a.role === 'host' && st.host === a.id) {
      st.hostAway = since;
      await this.ctx.storage.put('hostAway', st.hostAway);
    } else if (st.seats[String(a.id)] || this.inNight(a.id)) {
      st.away[String(a.id)] = since;
      await this.ctx.storage.put('away', st.away);
    }
    await this.scheduleAlarm(st);
  }

  override async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws, 1011); }

  override async alarm(): Promise<void> {
    // A socket that stopped pinging without closing is closed here and handled like any other drop. The grace
    // period counts from when it went silent, so a host that has been silent past the grace is replaced at once.
    for (const w of this.ctx.getWebSockets()) {
      if (w.readyState !== WebSocket.OPEN) continue;
      const a = attachmentOf(w);
      if (a.dead) continue;
      const last = this.lastHeard(w, a);
      if (Date.now() - last < SILENT_MS) continue;
      w.serializeAttachment({ ...a, dead: true });
      try { w.close(4004, 'silent'); } catch { /* already closed */ }
      await this.gone(a, last);
    }
    const st = await this.load(), now = Date.now();
    // The floor's safety nets: the turn limit, a holder that stopped saying floorHold, a holder with no live socket.
    const f = this.floor;
    if (f) {
      if (now >= f.until) await this.freeFloor('limit');
      else if (now - f.lastHold >= FLOOR_SILENT_MS) await this.freeFloor('silent');
      else if (!this.socketOf(f.holder)) await this.freeFloor('gone');
    }
    // Assume a close event can be missed: a host or a seated player with no live socket that is not yet marked away is
    // marked away now, so the normal grace / promotion / hand-over below always runs.
    if (st.host && !st.hostAway && !this.socketOf(st.host)) { st.hostAway = now; await this.ctx.storage.put('hostAway', now); }
    const night = this.core?.partyNight() ?? null;
    const members = [...Object.keys(st.seats), ...(night ? night.players.filter(p => p.present && p.id !== st.host).map(p => p.id) : [])];
    const lost = members.filter(id => !st.away[id] && !this.socketOf(id));
    if (lost.length) { for (const id of lost) st.away[id] = now; await this.ctx.storage.put('away', st.away); }
    // Clients gone longer than the grace period lose their seat (the computer takes the station) and leave the night.
    let seatsChanged = false;
    for (const [id, t] of Object.entries(st.away)) {
      if (now - t >= SEAT_GRACE_MS && !this.socketOf(id)) {
        Reflect.deleteProperty(st.away, id); Reflect.deleteProperty(st.seats, id); seatsChanged = true;
        if (this.inNight(id)) await this.partyOuts(this.core?.partyLeave(id) ?? [], null);
      }
    }
    if (seatsChanged) { await this.ctx.storage.put({ away: st.away, seats: st.seats }); this.broadcast({ t: 'seats', seats: st.seats }); }

    if (st.hostAway && now - st.hostAway >= HOST_GRACE_MS && !this.socketOf(st.host)) {
      // The lobby duty (meta, start) moves to a seated player who is still connected; the shift runs on here untouched
      //. In a party night the night's own rule picks them: the owner leaves the night and its next host
      // becomes the owner (partyOuts -> setOwner). Nobody seated: the room stays without an owner while anyone is here,
      // and the first to sit takes the duty; with no player left at all, the room dies.
      if (night && this.inNight(st.host ?? undefined)) await this.partyOuts(this.core?.partyLeave(st.host ?? '') ?? [], null);
      else if (!night && await this.promote(st)) { /* promoted */ }
      const anyone = this.ctx.getWebSockets().some(w => { const b = attachmentOf(w); return w.readyState === WebSocket.OPEN && !b.dead && b.role !== 'viewer'; });
      if (!anyone) {
        this.broadcast({ t: 'closed' });
        this.endRoom();
        await this.ctx.storage.deleteAll();
        return;
      }
    }
    await this.scheduleAlarm(await this.load());
  }

  /**
   * The lobby duty moves to the longest-seated client that is still connected (seated only, never a phone
   * without a seat or a viewer). False when nobody seated is here (the room then waits without an owner).
   */
  async promote(st: RoomState): Promise<boolean> {
    const live = Object.values(st.seats).filter(s => s.station && this.socketOf(s.id) && attachmentOf(must(this.socketOf(s.id), 'socket')).role === 'client').sort((x, y) => x.at - y.at);
    const next = live[0];
    if (!next) return false;
    Reflect.deleteProperty(st.seats, String(next.id));
    const ws = must(this.socketOf(next.id), 'socket of the promoted client');
    ws.serializeAttachment({ ...attachmentOf(ws), role: 'host' });
    await this.ctx.storage.put({ host: next.id, hostAway: 0, seats: st.seats });
    st.host = next.id ?? null; st.hostAway = 0;
    this.send(ws, { t: 'promote', station: next.station, seats: st.seats, meta: st.meta });
    this.broadcast({ t: 'host', id: next.id }, ws);
    this.broadcast({ t: 'seats', seats: st.seats });
    return true;
  }

  async scheduleAlarm(st: RoomState): Promise<void> {
    const due: number[] = [];
    // (an owner gone past the grace with nobody seated to take over: the heartbeat below re-checks, no busy alarm)
    if (st.hostAway && st.hostAway + HOST_GRACE_MS > Date.now()) due.push(st.hostAway + HOST_GRACE_MS);
    for (const t of Object.values(st.away)) due.push(t + SEAT_GRACE_MS);
    const live = this.ctx.getWebSockets().some(w => w.readyState === WebSocket.OPEN && !attachmentOf(w).dead);
    if (live) due.push(Date.now() + HEARTBEAT_MS);
    if (this.floor) due.push(Math.min(this.floor.until, this.floor.lastHold + FLOOR_SILENT_MS));
    if (due.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...due)));
  }

  socketOf(id: string | null | undefined): WebSocket | null {
    if (!id) return null;
    return this.ctx.getWebSockets().find(w => {
      const a = attachmentOf(w);
      return a.id === id && !a.dead && w.readyState === WebSocket.OPEN;
    }) || null;
  }

  /** Send to every open socket (optionally only one role), skipping `except`. */
  broadcast(msg: string | object, except?: WebSocket, role?: Role): void {
    const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const w of this.ctx.getWebSockets()) {
      if (w === except || w.readyState !== WebSocket.OPEN) continue;
      const a = attachmentOf(w);
      if (a.dead || (role && a.role !== role)) continue;
      try { w.send(text); } catch { /* closing socket */ }
    }
  }

  send(ws: WebSocket, msg: string | object): void {
    try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* closing socket */ }
  }
}

/* ===================== helpers ===================== */

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
const clampInt = (v: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
// eslint-disable-next-line no-control-regex -- stripping control characters from a player name is the point
const cleanName = (s: unknown): string => str(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
/** `String(v)` on an untrusted value, exactly as the JS called it (a plain object becomes '[object Object]'). */
const str = (v: unknown): string => String(v);
/** A daily score may only be for yesterday, today or tomorrow (players are in different time zones). */
function nearToday(day: string): boolean {
  const [y, mo, d] = day.split('-').map(Number);   // DAY_RE checked: three numbers
  const t = Date.UTC(y ?? NaN, (mo ?? NaN) - 1, d ?? NaN);
  return Math.abs(t - Date.now()) < 2.5 * 86400e3;
}
async function sha256hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64urlBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const b64urlText = (s: string): string => new TextDecoder().decode(b64urlBytes(s));
function b64urlFromBytes(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlFromText = (s: string): string => b64urlFromBytes(new TextEncoder().encode(s));

/** JSON.parse, typed as what it is: untrusted until checked. */
function parseJson(text: string): unknown {
  const v: unknown = JSON.parse(text);
  return v;
}
/**
 * `v[k]` exactly as the JS read it: the same TypeError on null / undefined, a primitive's own wrapper properties,
 * undefined for a missing key.
 */
function field(v: unknown, k: string): unknown {
  if (v === null || v === undefined) throw new TypeError(`Cannot read properties of ${String(v)} (reading '${k}')`);
  const o: unknown = Object(v);
  if (typeof o !== 'object' || o === null) return undefined;
  const r: unknown = Reflect.get(o, k);
  return r;
}
/** Unwraps a value the JS assumed is present. Throws where the JS would have thrown on it anyway. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new TypeError(`chakei: missing ${what}`);
  return v;
}
/** `String(err && err.message || err)`, the error detail the JS answered with. */
function errDetail(err: unknown): string {
  const msg = err ? field(err, 'message') : undefined;
  return String((err && msg) || err);
}
