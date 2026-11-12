// 組隊：一個人開房做「老闆」（揀關卡、開工），朋友入房揀位。間房（伺服器）做球證，行成間舖嘅共用部分
// 每部機自己做自己個位（即刻做，唔使等），做完嘅結果傳俾間房；間房每 0.25 秒報時，有變就傳一份共用狀態
// The page's side of the co-op model: the room transport (WebSocket
// to the Worker's Durable Object), the lobby (meta and seats, relayed by the room), and the wiring of core/coop: the
// room runs the referee (worker/index.ts, core/coop/room.ts) and every phone, the owner's ("host") too, joins it as a
// player (phoneJoin / phoneReceive / phoneFrame). The owner only sets up the lobby and starts each shift (`start`).
// Every message of the shift is a protocol envelope (`{t:'env', e}` through the room), checked by core/proto/validate.ts.
// Every top-level name is exported (the tests reach NET, ... through src/test-surface.ts).
import '../ui/floor-jobs';   // load order: src/entry.ts
import { showSeat, seatFrame, SEAT_NAMES, setSeatSwitcher, seatIdNow, homeSeat, seatLabel } from '../ui/seat';
import { isExtraKind } from '../core/referee/extras';
import { must } from '../core/util';
import { station, G, slot, diff, liveG, setStation, newGame, setDiff } from '../core/state';
import { installParty, partyOf } from '../core/coop/room';
import { mountParty, type PartyMount } from '../ui/party';
import { rejectText } from '../ui/party/view';
import { emit } from '../core/fx';
import { PORT } from '../core/env';
import { isRefEnv } from '../core/proto/validate';
import { refStop, setPaused as refSetPaused, isReferee, refStatsReset } from '../core/coop/referee';
import { phoneJoin, phoneReceive, phoneStop, phone, claim, release, away, back, askPause, phoneStatsReset, noteInput, seatFor } from '../core/coop/phone';
import { floorFrame } from '../ui/floor-jobs';
import { coopFrame } from '../core/coop/index';
import { $ } from '../ui/prefs';
import { STATIONS, SLOTS } from '../core/data/menus';
import { renderSheet } from '../ui/waiter';
import { toast, setNetEvent, grpEls, queueEl, setDrawn } from '../ui/ui';
import { applyView } from '../ui/floor-iso';
import { bossSay } from '../ui/career';
import { levelRoles, isFloorTask } from '../core/work/roles';
import { floorLevel } from '../core/work/floor';
import { xTrained, soloSwitch } from '../ui/xseat';
import { soloSeatOn } from '../core/career/xseat';
import { levelOpen, levelReached, LEVEL_IDS, armLevel, levelLeave, levelEnter, stDef, levelList, LEVELS, lvTag, lvGet, closestIn, stationOf } from '../ui/levels';
import { CLOUD, esc, cloudReady } from '../ui/cloud';
import { smokeShow } from '../ui/smoke';
import { myNick } from '../ui/outfit';
import { buildMenus, setLast, start, showStation, setEndHook } from '../ui/main';
import { ptMove } from '../core/playtest/hook';
import { pttBind, pttUnbind, pttIn, pttLink, pttLobbyCard, pttAskMic } from '../ptt/index';
import { motionAsk } from '../permit/motion';
import { checkStale } from '../ver/stale';

/** A seat's name: a shop station's, or an extra seat's. */
export const seatName = (k: string): string => isExtraKind(k) ? SEAT_NAMES[k] : /^floor\d$/.test(k) ? '樓面' + k.slice(5) : k === 'waiter' ? '樓面' : stDef(k).name;   // 伙記's seat is 樓面
/** The seat the host sits at: an extra seat, or their shop station. */
const hostSeat = (m: NetMeta): string => m.hostX || m.hostStation;
/** A 樓面 place of a room's lobby on a floor level (樓面1 / 樓面2, as a party night's). */
export const isLobbyFloor = (k: unknown): k is LobbyFloor => k === 'floor1' || k === 'floor2';
export const LOBBY_FLOOR: readonly LobbyFloor[] = ['floor1', 'floor2'];
/** The page's station for a lobby seat: a 樓面 place plays the waiter's screens (the referee seats it on the floor). */
const pageSt = (k: LobbySeat): StationId | ExtraKind | '' => isLobbyFloor(k) ? 'waiter' : k;
/** The extra seat this phone sits at in the room ('' = a shop station, or no room). */
export const netSeat = (): ExtraKind | '' => { const x = NET.hostX; return NET.role==='host' && !NET.myStation ? isExtraKind(x) ? x : '' : NET.role && isExtraKind(NET.myStation) ? NET.myStation : ''; };
/** JSON.parse, typed as what it is: data nobody has checked yet. */
export const netJson = (s: string): unknown => JSON.parse(s);
/*
 * Trust boundaries for the lobby messages (meta, seats, hello) the room relays as is. The shift's own messages are
 * protocol envelopes, validated in core (proto/validate.ts) before anything reads them.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
export function netTrustMsg(_m: unknown): asserts _m is NetMsg { /* a message from the room (worker/index.ts relays other phones' data as is) */ }
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter exists only to carry the assertion
export function netTrustRoom(_r: unknown): asserts _r is NetSavedRoom | null { /* sessionStorage 'ckf-room' */ }

/* ===================== 傳送：網上房（Worker） ===================== */
// NET.id 留喺 sessionStorage：同一個分頁重新載入都係同一個人，房會認得返（留返個位）
export const NET: NetState = { role:null, code:'', id: (() => { let i = ''; try { i = sessionStorage.getItem('ckf-netid') || ''; } catch { /* storage blocked */ } if (!/^[a-z0-9]{4,16}$/.test(i)){ i = Math.random().toString(36).slice(2, 10).padEnd(8, '0'); try { sessionStorage.setItem('ckf-netid', i); } catch { /* storage blocked */ } } return i; })(), seats:{}, meta:null, t:null };
// 網上：WebSocket 去 Worker 嘅 /api/room/<房號>（每間房一個 Durable Object，見 worker/index.ts Room）
// 斷線會自己駁返（同一個 NET.id，房會留返個位 15 秒；老闆斷線 6 秒冇返嚟就由坐得最耐嗰個朋友接手開工、揀關卡）
// Never trust a silence: a socket can stay "open" while nothing gets through (lift, tunnel, iOS suspending Safari),
// and a connect can hang with neither open nor close. We ping every 2 s and the room answers, so hearing nothing for
// LINK_DEAD_MS (or no open after LINK_CONNECT_MS) means the link is dead: drop that socket and reconnect as after a close.
export const LINK_QUIET_MS = 4000, LINK_DEAD_MS = 7000, LINK_CONNECT_MS = 10000;
export function wsTransport(code: string, role: NetRole): NetOnlineTransport {
  const subs: NetSubs = {}, on = <K extends keyof NetEvents>(k: K, f: (...a: NetEvents[K]) => void): void => { const s: { [P in K]?: ((...a: NetEvents[P]) => void)[] } = subs, l: ((...a: NetEvents[K]) => void)[] = s[k] || []; s[k] = l; l.push(f); }, fire = <K extends keyof NetEvents>(k: K, ...a: NetEvents[K]): void => { (subs[k] || []).forEach(f => { f(...a); }); };
  let ws: WebSocket | null = null, closed = false, tries = 0, meta: NetMeta | null = null, seats: NetSeats = {}, myRole: NetRole = role, pingT = 0, dogT = 0, heard = 0, pendingSeat: NetSeat | null | undefined, dbgN = 0;
  const dbgWait = new Map<number, (r: unknown) => void>();
  const T: NetOnlineTransport = {
    kind:'online', up:false, rtt:0,
    get role(){ return myRole; },
    // Connected, but nothing heard for a few seconds: the badge says the link is shaky before it is declared dead.
    get quiet(){ return T.up && performance.now() - heard > LINK_QUIET_MS; },
    setMeta(m){ meta = m; send({ t:'meta', meta:m }); },
    onMeta(f){ on('meta', f); if (meta) f(meta); },
    setSeat(s){ pendingSeat = s; send({ t:'seat', seat:s }); },
    onSeats(f){ on('seats', f); },
    // 未駁好（或者斷咗）就唔傳：結果留喺 core/coop/phone.ts 嘅 outbox，未確認嘅會重傳
    sendEnv(e){ if (T.up) send({ t:'env', e }); },
    onEnv: f => { on('env', f); },
    // 老闆開工：間房用呢啲設定開一更
    sendStart(s){ send({ t:'start', ...s }); },
    // tests only: the room's referee answers when the Worker runs with ROOM_DEBUG (tests/helpers/server.js)
    dbg(d){ const id = ++dbgN; send({ t:'dbg', id, d }); return new Promise(res => { dbgWait.set(id, res); }); },
    onPromote: f => { on('promote', f); },
    onHost: f => { on('host', f); },
    onStatus: f => { on('status', f); },
    // 對講機（src/ptt）：floor 訊息同聲音（binary）
    pttSend(m){ if (ws && ws.readyState===1) ws.send(m instanceof ArrayBuffer ? m : JSON.stringify(m)); },
    onPtt: f => { on('ptt', f); },
    // 派對之夜：個晚嘅狀態由間房話事，部機淨係傳撳咗乜
    partySend(m){ send(m); },
    onParty: f => { on('party', f); },
    // a teammate's 樓面 place switch goes to the owner (the room relays it), who decides and says so in meta
    slotSend(seat, onOff){ send({ t:'slot', seat, on: onOff }); },
    onSlot: f => { on('slot', f); },
    // 斷線但唔講再見（閂頁時用）：房會當你斷咗線，留位等你返
    drop(){ closed = true; clearInterval(pingT); clearInterval(dogT); try { if (ws) ws.close(4002, 'drop'); } catch { /* already closed */ } },
    close(){
      closed = true; clearInterval(pingT); clearInterval(dogT);
      if (ws && ws.readyState===1){ if (myRole==='host') send({ t:'close' }); else send({ t:'seat', seat:null }); }
      try { if (ws) ws.close(1000, 'bye'); } catch { /* already closed */ }
    },
  };
  function send(m: NetOut): void { if (ws && ws.readyState===1) ws.send(JSON.stringify(m)); }
  function connect(): void {
    const proto = location.protocol==='https:' ? 'wss:' : 'ws:';
    heard = performance.now();
    const sock = ws = new WebSocket(`${proto}//${location.host}/api/room/${code}?id=${NET.id}&role=${myRole}`);
    ws.binaryType = 'arraybuffer';   // push-to-talk audio frames
    ws.onopen = () => {
      heard = performance.now();
      T.up = true; T.everUp = true; tries = 0;
      // 斷線前嘅老闆資料、個位：駁返之後再報一次（老闆先認得你）
      if (myRole==='host' && meta) send({ t:'meta', meta });
      if (myRole==='client' && pendingSeat) send({ t:'seat', seat:pendingSeat });
      fire('status', 'up');
      const ping = (): void => { if (sock.readyState===1){ T.pingAt = performance.now(); sock.send('ping'); } };
      clearInterval(pingT); pingT = setInterval(ping, 2000); ping();
    };
    ws.onmessage = (e: MessageEvent<unknown>) => {
      heard = performance.now();
      if (e.data==='pong'){ if (T.pingAt) T.rtt = Math.round(performance.now() - T.pingAt); return; }
      // 對講機聲音（binary）：只有 src/ptt 用
      if (e.data instanceof ArrayBuffer){ fire('ptt', e.data); return; }
      if (e.data instanceof Blob){ e.data.arrayBuffer().then(b => { fire('ptt', b); }).catch(() => { /* a frame lost: the next one follows */ }); return; }
      // String(e.data): JSON.parse converts its argument to a string itself, so this is the same parse.
      let m: unknown; try { m = netJson(String(e.data)); } catch { return; }
      netTrustMsg(m);
      if (m.t==='env'){ fire('env', m.e); return; }
      if (m.t==='hello'){
        myRole = m.you;
        if (m.meta && myRole==='client'){ meta = m.meta; fire('meta', meta); }
        seats = m.seats || {}; fire('seats', { ...seats });
        // 對講機：一駁上就知而家邊個講緊（冇 = 冇人）
        const f = m.floor; fire('ptt', f ? { t:'floor', ...f } : { t:'floor', holder:null, name:'', turn:0, left:0 });
      }
      else if (m.t==='floor' || m.t==='floorNo') fire('ptt', m);
      else if (m.t==='meta'){ meta = m.meta; fire('meta', meta); }
      else if (m.t==='seats'){ seats = m.seats || {}; fire('seats', { ...seats }); }
      else if (m.t==='closed'){ closed = true; fire('meta', { ...(meta || {}), state:'closed' }); }
      else if (m.t==='dbg'){ const f = dbgWait.get(m.id); dbgWait.delete(m.id); if (f) f(m.res); }
      else if (m.t==='host') fire('host', m.id);
      else if (m.t==='party') fire('party', m);
      else if (m.t==='promote'){ myRole = 'host'; pendingSeat = null; fire('promote', m); }
      else if (m.t==='slot') fire('slot', m.seat, m.on);
      else {   // m.t==='error' (the last kind)
        if (m.error==='no_room'){ closed = true; fire('meta', null); fire('status', 'noroom'); }
        else if (m.error==='taken'){ closed = true; fire('status', 'taken'); }
        else if (m.error==='seat_taken'){ pendingSeat = null; fire('status', 'seat_taken'); }
      }
    };
    ws.onclose = () => { if (sock===ws){ ws = null; lost(); } };
  }
  function lost(): void {
    T.up = false; clearInterval(pingT);
    if (closed) return;
    fire('status', 'down');
    // 1、2、4……最多 5 秒再試
    setTimeout(() => { if (!closed) connect(); }, Math.min(5000, 500 * 2 ** tries++));
  }
  // Watchdog: a silent socket (or a connect that never opens) is abandoned without waiting for the browser to notice.
  // If this page itself was stalled (a long task, a frozen or suspended tab), messages that arrived meanwhile may still be
  // queued behind this timer: start a fresh deadline and ping, rather than blame the link for our own pause.
  let dogAt = performance.now();
  dogT = setInterval(() => {
    const now = performance.now(), stalled = now - dogAt > 2500; dogAt = now;
    if (closed || !ws) return;
    if (stalled){ heard = now; if (ws.readyState===1){ T.pingAt = now; ws.send('ping'); } return; }
    if (now - heard < (T.up ? LINK_DEAD_MS : LINK_CONNECT_MS)) return;
    const old = ws; ws = null;
    old.onopen = old.onmessage = old.onclose = null;
    try { old.close(4005, 'silent'); } catch { /* already closed */ }
    lost();
  }, 1000);
  connect();
  return T;
}

// 組隊淨係網上有（間房做球證）；?localnet（同一部機分頁）已經冇咗
export const netOnline = (): boolean => typeof CLOUD!=='undefined' && CLOUD.on;
export const makeTransport = (code: string, role: NetRole): NetTransport => wsTransport(code, role);

/* ===================== 一更嘅訊息（信封） ===================== */
/** The round this phone last began (a new round's first keyframe starts its shift); -1: none. */
export let lastRound = -1;
/** The round this phone has said hello to the referee for, when, and the round it has claimed its seat in. */
export let helloRound = -1, helloAt = 0, claimedRound = -1;
const sendEnvelope = (e: unknown): void => { if (NET.t) NET.t.sendEnv(e); };
/** A protocol envelope from the room's referee: every phone, the owner's too, applies it; a new round's starts a shift. */
export function netEnv(raw: unknown): void {
  const now = performance.now();
  // a player still choosing a seat stays in the room view: its replica starts with the welcome after the pick
  if (!NET.role || !phone() || !NET.myStation) return;
  const fresh = clientPrepare(raw);
  phoneReceive(raw, now);
  const P = phone();
  if (P && P.rejected && P.rejected.reason==='proto'){ toast('請重新載入（你部機嘅版本同老闆唔同）'); netLeave(); backToStart(); return; }
  if (fresh) clientBegin();
  else if (isRefEnv(raw) && (raw.b.k==='keyframe' || raw.b.k==='tick')) syncLocalUI();
}
/** A keyframe of a round this phone has not begun, while the shift runs: a fresh shift here, then the keyframe fills it. */
function clientPrepare(raw: unknown): boolean {
  if (!isRefEnv(raw)) return false;
  const b = raw.b;
  if (b.k!=='welcome' && b.k!=='keyframe') return false;
  if (raw.to !== undefined && raw.to !== NET.id) return false;
  const k = b.key, sh = k.shared;
  if (k.round === lastRound || typeof sh!=='object' || sh===null || Reflect.get(sh, 'running')!==true) return false;
  lastRound = k.round; NET.round = k.round;
  const lv: unknown = Reflect.get(sh, 'level');
  levelLeave(); if (typeof lv==='string' && LEVELS[lv]) armLevel(lv);
  partyPace(Reflect.get(sh, 'party'));
  // the page underneath an extra seat: the owner's own shop station, a teammate's the floor
  const my = pageSt(NET.myStation || '');
  setStation(my && !isExtraKind(my) ? my : NET.role==='host' ? station : 'waiter');
  newGame(); liveG().coop = true;
  return true;
}
/** Say hello to the referee (again): on a shift starting, after a reconnect, and until a keyframe of the round arrives. */
function clientHello(): void {
  if (!NET.role || !NET.t) return;
  helloAt = performance.now(); helloRound = NET.meta ? NET.meta.round : -1;
  phoneJoin({ room: NET.code, me: NET.id, name: myNick(), send: sendEnvelope, now: helloAt, caps: { z: false, cs: true, ptt: true } });
}
/** Every frame (main.ts loop): this phone's resends, hellos and its seat's claim. */
export function netFrame(now: number): void {
  if (!NET.role) return;
  coopFrame(now);
  seatFrame();
  floorFrame();   // 樓面: the job bar and the job's mini-game
  const P = phone(), m = NET.meta;
  // the shift runs and this phone has no keyframe of it yet: hello again every 2 s (the referee may not have been there)
  if (m && m.state==='playing' && (!P || !P.key || P.round < m.round) && now - helloAt > 2000) clientHello();
  // a seat chosen in the room: claim it once per shift (a lobby seat is granted on hello; a mid-shift one is claimed)
  const st = NET.myStation;
  if (P && P.key && st && G && G.running && P.round===lastRound && claimedRound!==P.round){ claimedRound = P.round; if (G.roles[st]!=='me') claim(st); }
}

/* ===================== 開房、入房、離開 ===================== */
// 所有事件都喺呢度掛一次；收到嘢時睇返自己而家係老闆定朋友（朋友可能中途升做老闆）
export function wireTransport(): void {
  const T = must(NET.t, 'NET.t');
  T.onSeats(s => {
    NET.seats = s;
    // a teammate sat at a switched-off 樓面 place: sitting there switched it on (the owner says so in meta)
    if (NET.role==='host' && NET.meta && (NET.floorOff ?? []).some(k => mateAt(k))) pushMeta(NET.meta.state);
    renderCoop();
  });
  T.onSlot((seat, on) => { if (NET.role==='host' && isLobbyFloor(seat)) floorSlot(seat, on, true); });
  T.onEnv(netEnv);
  T.onMeta(m => {
    if (NET.role==='host'){
      // the room says when its shift plays and which round it is, and when the books closed (lobby
      // again): the owner's phone joins each shift like everyone's
      if (m && m.state!=='closed' && NET.meta){
        NET.meta = { ...NET.meta, state: m.state, round: m.round }; NET.round = m.round;
        if (m.state==='playing' && NET.myStation && m.round!==helloRound) clientHello();
      }
      return;
    }
    if (!m || m.state==='closed'){ if (NET.meta){ toast('老闆走咗，間舖收咗'); netLeave(); backToStart(); } return; }
    NET.meta = m; renderCoop();
    // 老闆開咗新一更：同球證打招呼
    if (m.state==='playing' && m.round!==helloRound) clientHello();
    // 重新載入之後：自動坐返之前個位（派對夜嘅位由個夜分）
    if (NET.rejoinSt && !NET.myStation && !m.party){ const st = NET.rejoinSt; NET.rejoinSt = ''; pickSeat(st, true); }
    else migrateSeat(m);   // the owner picked a level with (or without) 樓面
  });
  T.onPromote(becomeHost);
  T.onParty(partyIn);
  // 對講機：淨係網上房有。In a shift at the bottom of the game column; also in the room's lobby
  // once this phone sits (the owner sits as the room opens), at the bottom of the lobby overlay
  {
    const L = T;
    const lobby = (): boolean => !must($('coopView'), 'coopView').hidden && (NET.role==='host' || !!NET.myStation);
    pttBind({ id: NET.id, up: () => L.up, send: m => { L.pttSend(m); } }, { name: myNick, shown: () => !!(G && G.coop) || lobby(), mount: () => lobby() ? $('coopView') : $('app') });
    L.onPtt(pttIn);
    L.onStatus(() => { pttLink(L.up); });
  }
  T.onHost(id => { if (NET.role==='client' && id!==NET.id) toast('換咗老闆'); });
  T.onStatus(s => {
    NET.link = s;
    if (s==='taken' && NET.role==='host'){
      // 啱啱開房就撞號：換個再開。做緊老闆斷線太耐、已經由朋友接手：做返隊友，坐返自己個位（電腦做緊嗰個）
      if (!must(NET.t, 'NET.t').everUp){ hostRoom(); return; }
      const code = NET.code, st = NET.myStation || station;
      if (G) G.running = false;
      joinRoom(code, st); must($('coopView'), 'coopView').hidden = false;
      toast('你斷線太耐，朋友接手做咗老闆；你而家做隊友'); return;
    }
    if (s==='noroom' && NET.role==='client'){ const m = $('coopMsg'); if (m) m.textContent = '搵唔到呢間房，睇吓房號啱唔啱。'; return; }
    if (s==='seat_taken'){ NET.myStation = ''; toast('呢個位啱啱有人坐咗'); }
    if (s==='down' && G && G.coop && G.running) toast('斷咗線，駁緊返……');
    if (s==='up' && NET.wasDown && G && G.coop) toast('駁返咗');
    // 駁返：再同球證打招呼（佢會由確認咗嘅號碼繼續；未確認嘅結果由 outbox 重傳）
    if (s==='up' && phone()) clientHello();
    // a room made on the entry's 派對 side opens its night as soon as the link is up
    if (s==='up' && NET.role==='host' && partyWanted){ partyWanted = false; if (!NET.night) partySend({ t:'partyOpen', name: myNick() }); }
    NET.wasDown = s==='down';
    renderCoop(); netBadge();
  });
}
export function hostRoom(): void {
  netLeave();
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  NET.code = Array.from({ length:4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  NET.role = 'host'; NET.t = makeTransport(NET.code, 'host'); NET.seats = {}; NET.extra = []; NET.hostX = ''; NET.floorOff = [];
  NET.level = NET.level && levelOpen(NET.level) ? NET.level : LEVEL_IDS.filter(levelReached).pop();   // the furthest reached by progress, also on the preview
  wireTransport();
  pushMeta('lobby');
  renderCoop();
  void checkStale(true);   // a room lobby opens on the newest build
}
/** The room's level when it has stations of its own (`roles`), else null (core/coop/room.ts roomShiftOf decides
 *  the same in the room). */
const rolesLevel = (id: string | undefined): Level | null => { const lv = id && LEVELS[id] ? lvGet(id) : null; return lv && levelRoles(lv).length ? lv : null; };
/**
 * The extra seats of the room's next shift: a level's own stations, else none (there are no
 * 加位 toggles). 傳菜 / 外賣 are 樓面's tasks, never seats, and 燒味 belongs to the levels that have it,
 * so a level without roles of its own has no extra station to add.
 */
const roomExtras = (id = NET.level): ExtraKind[] => { const lv = rolesLevel(id); return lv ? levelRoles(lv) : []; };
/** The room's level runs 樓面 (floorLevel): its lobby seats 樓面1 and 樓面2, else the single 伙記 seat. */
const roomFloor = (id = NET.level): boolean => { const lv = id && LEVELS[id] ? lvGet(id) : null; return !!lv && floorLevel(lv); };
/**
 * The room's seats in the lobby, in its order (roles only): 樓面1 and 樓面2 on a floor level
 * (else 伙記's single seat, which reads 樓面), the shop's three, then the level's stations of their own (燒味), never a
 * 傳菜 / 外賣 seat. The room's referee seats the 樓面 places on its floor seats (core/coop/referee.ts refStart floorAt).
 */
const lobbyKeys = (id: string | undefined, ex: readonly ExtraKind[]): string[] =>
  [...(roomFloor(id) ? LOBBY_FLOOR : ['waiter']), ...Object.keys(STATIONS).filter(k => k !== 'waiter'), ...ex.filter(k => !isFloorTask(k))];
/** A teammate (not the owner) sits at lobby seat k. */
const mateAt = (k: string): boolean => Object.values(NET.seats).some(s => s.station === k);
/** Somebody sits at lobby seat k: the owner or a teammate (other than this phone when `notMe`). */
const heldBy = (k: string, notMe = false): boolean => (!!NET.meta && hostSeat(NET.meta) === k && !(notMe && NET.role === 'host')) || Object.values(NET.seats).some(s => s.station === k && !(notMe && s.id === NET.id));
/** The room's switched-off 樓面 places as this phone knows them (a seated place is never off: sitting there switched it on). */
const offNow = (): LobbyFloor[] => ((NET.role === 'host' ? NET.floorOff : NET.meta?.floorOff) ?? []).filter(k => !heldBy(k));
/**
 * The owner's seat follows the level: a 樓面 place exists only on a floor level (elsewhere the owner is back at
 * the waiter's seat), a level's station only where the level has it, and an owner at the waiter's seat on a floor level
 * sits at the first 樓面 place no teammate holds.
 */
function hostFix(): void {
  const fl = roomFloor(), x = NET.hostX || '';
  if (isLobbyFloor(x) && !fl){ NET.hostX = ''; setStation('waiter'); }
  else if (isExtraKind(x) && !roomExtras().includes(x)) NET.hostX = '';
  if (fl && !NET.hostX && station === 'waiter') NET.hostX = LOBBY_FLOOR.find(k => !mateAt(k)) ?? 'floor1';
}
export function pushMeta(state: NetMeta['state']): void {
  hostFix();
  // a place someone sits at is on (the same rule as a party night's), and no place is off without the floor
  const hx = NET.hostX || '';
  NET.floorOff = roomFloor() ? (NET.floorOff ?? []).filter(k => k !== hx && !mateAt(k)) : [];
  NET.meta = { host: NET.id, hostName: myNick(), hostStation: station, slot, diff, state, level: NET.level || '', round: NET.round || 0, at: Date.now(), extra: roomExtras(), hostX: hx, floorOff: [...NET.floorOff] };
  must(NET.t, 'NET.t').setMeta(NET.meta);
}
/**
 * A free 樓面 place switched on (the computer's) or off for the next shift, as the party lobby's 開位 / 熄位
 *. The owner decides; a teammate's switch goes to the owner through the room. Refused for a place
 * someone sits at, while a shift runs (a shift keeps the layout it started with), without the floor, and when it would
 * switch off the last place on.
 */
export function floorSlot(k: LobbyFloor, on: boolean, quiet = false): boolean {
  if (NET.role === 'client'){ if (NET.t && NET.meta && NET.meta.state !== 'playing') NET.t.slotSend(k, on); return true; }
  const say = (s: string): false => { if (!quiet) toast(s); return false; };
  if (NET.role !== 'host' || !NET.meta || !roomFloor()) return false;
  if (NET.meta.state === 'playing') return say('開緊工，下一更先改得');
  if (heldBy(k)) return say('有人坐咗呢個位');
  const off = (NET.floorOff ?? []).filter(x => x !== k);
  if (!on && LOBBY_FLOOR.every(x => x === k || off.includes(x))) return say('最少要開一個樓面位');
  NET.floorOff = on ? off : [...off, k];
  pushMeta('lobby'); renderCoop();
  return true;
}
/** The 樓面 places switched on for the next shift: the shift's floor seats (core/coop/room.ts roomShiftOf). */
export const floorOnNow = (): number => Math.max(1, LOBBY_FLOOR.filter(k => !offNow().includes(k)).length);
export function joinRoom(code: string, rejoinSt?: LobbySeat): void {
  netLeave();
  NET.code = code.trim().toUpperCase(); NET.role = 'client'; NET.t = makeTransport(NET.code, 'client'); NET.meta = null; NET.myStation = ''; NET.rejoinSt = rejoinSt || '';
  wireTransport();
  renderCoop();
  void checkStale(true);   // a room lobby opens on the newest build
  setTimeout(() => { if (NET.role==='client' && !NET.meta){ const m = $('coopMsg'); if (m) m.textContent = '搵唔到呢間房，睇吓房號啱唔啱。'; } }, 4000);
}
export function netLeave(): void {
  // 隊友撳咗暫停跟住走人（暫停→唔做喇）：幫佢解除暫停，唔係成間舖會一直停住等佢；個位即刻交返俾電腦
  if (NET.role && phone()){
    try { if (G && G.coop && G.paused) askPause(false); if (NET.myStation && G && G.roles[NET.myStation]==='me') release(NET.myStation); } catch { /* best effort */ }
  }
  pttUnbind();   // 講緊嘢就先交返個台
  if (NET.t){ try { NET.t.close(); } catch { /* already closed */ } }
  phoneStop(); refStop();
  partyPace(null); partyUnmount();
  Object.assign(NET, { role:null, code:'', t:null, seats:{}, meta:null, myStation:'', link:'', night:null });
  lastRound = -1; helloRound = -1; claimedRound = -1;
  try { sessionStorage.removeItem('ckf-room'); } catch { /* storage blocked */ }
  netBadge();
}
export const mySeat = (): NetSeat | undefined => Object.values(NET.seats).find(s => s.id===NET.id) || NET.seats[NET.id];
/**
 * This teammate sits at lobby seat st0 (a free seat, or one the computer runs mid-shift). On a floor level the
 * waiter's (or an old 傳菜 / 外賣) key means the first free 樓面 place (a reload of an older page); a switched-off place
 * is switched on by sitting there in the lobby, but not mid-shift (the running shift has no seat for it).
 */
export function pickSeat(st0: Exclude<LobbySeat, ''>, quiet?: boolean): void {
  const m = NET.meta; if (!m) return;
  const fl = roomFloor(m.level);
  const st: Exclude<LobbySeat, ''> = fl && (st0==='waiter' || isFloorTask(st0)) ? LOBBY_FLOOR.find(k => !heldBy(k, true)) ?? 'floor1' : st0;
  if (isLobbyFloor(st) && (!fl || (m.state==='playing' && (m.floorOff ?? []).includes(st)))){ if (!quiet) toast(fl ? '呢個樓面位熄咗，下一更先開得' : '呢關冇呢個位'); return; }
  if (st===hostSeat(m) || (isExtraKind(st) && !(m.extra || []).includes(st)) || Object.entries(NET.seats).some(([k, s]) => k!==NET.id && s.station===st)){ if (!quiet) toast('呢個位有人'); return; }
  NET.myStation = st; claimedRound = -1; must(NET.t, 'NET.t').setSeat({ name: myNick(), station: st, id: NET.id, z: false }); renderCoop();
  if (m.state==='playing') clientHello();   // mid-shift: the welcome's keyframe starts the shift here at once
  try { sessionStorage.setItem('ckf-room', JSON.stringify({ code: NET.code, st })); } catch { /* storage blocked */ }
}
export function backToStart(): void { if (G) G.running = false; ['endView','pauseView','coopView'].forEach(id => { must($(id), id).hidden = true; }); must($('startView'), 'startView').hidden = false; buildMenus(); }

/* ===================== 老闆（開房嗰個）：揀關卡、開工 ===================== */
// 朋友升做老闆（舊老闆斷線冇返嚟）：間舖照開（球證喺間房度），你而家負責揀關卡、開下一更
export function becomeHost(m: NetPromote): void {
  NET.role = 'host'; NET.seats = m.seats || {};
  // the seat this phone plays stays its own; the lobby now lists it as the owner's (hostStation / hostX)
  // (the room's seat list has the lobby key, 樓面1 / 樓面2, where this phone's page plays the waiter)
  const mine: LobbySeat = m.station || NET.myStation || station;
  if (isExtraKind(mine) || isLobbyFloor(mine)) NET.hostX = mine;
  else { NET.hostX = ''; setStation(mine); }
  if (m.meta){ NET.level = m.meta.level; NET.round = m.meta.round; NET.extra = m.meta.extra || []; NET.floorOff = m.meta.floorOff ?? []; }
  pushMeta(m.meta && m.meta.state==='playing' ? 'playing' : 'lobby');
  try { sessionStorage.removeItem('ckf-room'); } catch { /* storage blocked */ }
  toast('老闆走咗，你而家做老闆（揀關卡、開工）'); renderCoop(); netBadge();
}
// Page code's hints for a station another player holds (ui.ts say / floatAt with a remote role): a referee on this
// phone (the solo room of one) routes them as effects; in a room the referee is the room's.
setNetEvent(e => { if (!isReferee()) return; if (e.msg) emit({ k:'say', role: stationOf(e.role), msg: e.msg }); if (e.float) emit({ k:'float', table: e.float[0], text: e.float[1], color: e.float[2] }); });
// NET.level is set whenever a room is open (hostRoom); armLevel would throw on a missing level anyway (lvGet).
export function hostStart(): void { must($('coopView'), 'coopView').hidden = true; armLevel(must(NET.level, 'NET.level')); start(); }
// start() 一開頭叫：老闆叫間房開工（間房做球證）；朋友唔可以自己開工。兩樣都唔喺呢部機開一更：等間房嘅 keyframe
export function netBeforeStart(): boolean {
  if (NET.role==='client'){ toast('等老闆開工'); return false; }
  if (NET.role==='host'){ sendStart(); return false; }
  return true;
}
/**
 * The owner's start: the lobby's seat for the owner (meta's hostStation / hostX, which the room seats), then the
 * shift's settings: the level itself, and what this phone's save answers for the shop (rank, the level's recipe levels
 * and names). The shift starts here with the room's first keyframe, as on every phone.
 */
export function sendStart(): void {
  const T = NET.t; if (!T) return;
  const level = NET.level && LEVELS[NET.level] ? NET.level : '', lv = level ? lvGet(level) : null;
  NET.myStation = NET.hostX || station;
  pushMeta(NET.meta ? NET.meta.state : 'lobby');
  const rlv: Record<string, number> = {}, names: Record<string, string> = {};
  for (const k of lv ? lv.menu : []){ rlv[k] = PORT.recipeLv(k); const n = PORT.fancyName(k); if (n) names[k] = n; }
  // the 樓面 places switched on are the shift's floor seats (core/coop/room.ts roomShiftOf)
  T.sendStart({ level, lv, slot, diff, extra: roomExtras(), port: { rank: PORT.rankIx(), rlv, names }, ...(roomFloor() ? { floorOn: floorOnNow() } : {}) });
}
/** Pause / resume: a referee on this phone (solo seat) pauses; in a room the phone asks the room's (and shows it at once). */
export function netPause(on: boolean): void {
  if (isReferee()) refSetPaused(on);
  else if (NET.role && phone()) askPause(on);
}
/** Test surface: starts a new result audit window (the referee's and this phone's counters). */
export function auditReset(): void { refStatsReset(); phoneStatsReset(); }

/* ===================== 朋友部機 ===================== */
// 新一更開始：揀返自己個位嘅畫面
export function clientBegin(): void {
  ['startView','endView','pauseView','coopView'].forEach(id => { must($(id), id).hidden = true; });
  { const lv = liveG().level; if (lv) levelEnter(lv); }
  // 樓面: on a floor shift the lobby's 伙記, 傳菜 and 外賣 seats are floor seats: the waiter's screens and the job bar
  // a lobby 樓面 place (樓面1 / 樓面2) is a floor seat too; the room's seat list keeps the place's key
  if (isLobbyFloor(NET.myStation) || (liveG().floor && (NET.myStation==='waiter' || NET.myStation==='runner' || NET.myStation==='takeaway'))){ NET.myStation = 'waiter'; setStation('waiter'); }
  const st = NET.myStation;
  must($('clockLbl'), 'clockLbl').textContent = SLOTS[liveG().slot].name; grpEls.forEach(el => { el.remove(); }); grpEls.clear(); must(queueEl, 'queue').innerHTML = ''; must($('fx'), 'fx').innerHTML = '';
  must($('floorWrap'), 'floorWrap').hidden = must($('doorWrap'), 'doorWrap').hidden = st!=='waiter';
  must($('till'), 'till').hidden = must($('pad'), 'pad').hidden = st!=='till'; must($('barView'), 'barView').hidden = must($('barPad'), 'barPad').hidden = st!=='bar'; must($('kitView'), 'kitView').hidden = must($('kitPad'), 'kitPad').hidden = st!=='kitchen';
  // `?? null`: no station shows no label (textContent treats null as empty).
  const mis: Partial<Record<string, string>> = { till:'計錯', bar:'沖錯', kitchen:'整錯', waiter:'落錯單' };
  must($('misLbl'), 'misLbl').textContent = mis[String(st)] ?? null;
  must($('angLbl'), 'angLbl').textContent = st==='till' ? '走數' : '嬲走';
  showSeat(isExtraKind(st) ? st : '', NET.id);
  if (typeof applyView==='function') applyView();
  setDrawn(0); setLast(performance.now());
  bossSay(NET.role==='host' ? `組隊開工！你做${seatName(String(st))}。` : `組隊開工！你做${seatName(String(st))}，老闆係${NET.meta ? NET.meta.hostName : '佢'}。`);
}
// 落單紙、暫停呢啲本機畫面跟返共用狀態
export let sheetVer = -1;
export function syncLocalUI(): void {
  const S = liveG();
  document.body.classList.toggle('fever', !!S.fever);
  const sheetOpen = !must($('sheetWrap'), 'sheetWrap').hidden;
  if (NET.myStation==='waiter' && S.sheet){ if (!sheetOpen || sheetVer !== S.sheet.gid){ sheetVer = S.sheet.gid; must($('sheetWrap'), 'sheetWrap').hidden = false; renderSheet(); } }
  else if (sheetOpen) must($('sheetWrap'), 'sheetWrap').hidden = true;
  if (S.running && S.paused && must($('pauseView'), 'pauseView').hidden){ must($('pauseView'), 'pauseView').hidden = false; smokeShow(); }
  if (!S.paused && !must($('pauseView'), 'pauseView').hidden) must($('pauseView'), 'pauseView').hidden = true;
  setDrawn(0);
}
// 有郁就話俾球證知（佢靠呢個分「停咗唔郁」：30 秒有嘢做又冇郁先由電腦幫手）
const touched = (): void => { const st = NET.myStation; if (NET.role && phone() && st && G && G.running && G.roles[st]==='me') noteInput(st); };
addEventListener('keydown', touched, true);
// 電腦幫緊手（斷線、閂咗機、停咗唔郁）：一撳畫面就攞返個位（換返我）
addEventListener('pointerdown', () => {
  touched();
  const P = phone(), st = NET.myStation;
  if (!NET.role || !P || !st || !G || !G.running || G.roles[st]!=='ai') return;
  const s = P.seats[seatFor(st)];   // 樓面: the floor seat the waiter's screens play
  if (s && s.last===NET.id && (s.coverReason==='quiet' || s.coverReason==='away' || s.coverReason==='link')) claim(st);
}, true);
// 閂咗機／轉咗去第二個 app：即刻話俾球證知（電腦即刻幫手），返嚟就攞返
document.addEventListener('visibilitychange', () => { if (NET.role && phone()){ if (document.hidden) away('hidden'); else back('hidden'); } });

/* ===================== 組隊畫面 ===================== */
/** The room the lobby's mic card was last shown for (a new room resets it). */
let micCardRoom = '';
/** The multiplayer entry's two modes, 組隊 (a level) and 派對 (a party night, a shop). */
export type MpMode = 'coop' | 'party';
export const MP_MODE_KEY = 'ckf-mpmode';
/** The last mode picked on the switch (localStorage; 組隊 when there is none or storage is blocked). */
export function mpMode(): MpMode { try { return localStorage.getItem(MP_MODE_KEY)==='party' ? 'party' : 'coop'; } catch { return 'coop'; } }
function setMpMode(m: MpMode): void { try { localStorage.setItem(MP_MODE_KEY, m); } catch { /* storage blocked: the switch still works this visit */ } }
/** A 派對 room was asked for on the entry: the night opens as soon as the new room's link is up (wireTransport). */
let partyWanted = false;
/**
 * The 組隊 | 派對 switch: on the entry (`entry`, flips the content in place) and at the top of the owner's lobby between
 * shifts or nights (`room`, flips the room itself: 派對 opens a night, 組隊 closes it). The room's tabs keep the ids the
 * old 「開派對夜」 / 「返去普通組隊」 buttons had (#partyOpen / #partyClose).
 */
function modeSwitch(on: MpMode, where: 'entry' | 'room'): string {
  const id = (k: MpMode): string => where==='room' && k!==on ? ` id="${k==='party' ? 'partyOpen' : 'partyClose'}"` : '';
  return `<div class="mpsw" role="tablist" data-where="${where}">${(['coop', 'party'] as const).map(k => `<button type="button" role="tab"${id(k)} data-mode="${k}" aria-selected="${String(k===on)}" class="${k===on ? 'on' : ''}">${k==='party' ? '派對' : '組隊'}</button>`).join('')}</div>`;
}
export function renderCoop(): void {
  const v = $('coop'); if (!v) return;
  const online = netOnline();
  const how = online ? '朋友喺佢部手機打開遊戲，撳「組隊」，輸入房號。' : '組隊要上網先玩得（間房喺伺服器度做球證）：而家未接駁網上。';
  if (!NET.role){
    // 組隊 and 派對 are two modes of one entry: a switch at the top flips the content in place
    const md = mpMode(), party = md==='party';
    v.innerHTML = `<div class="sh-head"><b>${party ? '派對' : '組隊'}</b><span>${online ? '網上' : '未接駁'}</span></div>
      ${modeSwitch(md, 'entry')}
      <p class="hint" id="mpHint">${party ? '派對夜：開房做老闆，一齊揀舖、落注、輪流坐唔同位；入房之後喺房入面揀舖。' : '一個人開房做老闆（佢揀嘅關卡就係成間舖嘅），朋友入房揀位；冇人做嘅位由電腦補。入房之後喺房入面揀關卡。'}</p>
      <button type="button" class="big" id="hostBtn">${party ? '開派對房（我做老闆）' : '開房（我做老闆）'}</button>
      <div class="joinrow"><input id="roomIn" maxlength="4" placeholder="房號" autocapitalize="characters" aria-label="房號"><button type="button" class="big alt" id="joinBtn">入房</button></div>
      <p class="hint" id="coopMsg">${online ? '有房號就入房：組隊房定派對房都得，會帶你去嗰間房。' : how}</p>
      <button type="button" class="big alt" id="coopClose">返去</button>`;
    return;
  }
  if (NET.night){ renderParty(v, NET.night); micCard(v); return; }
  const m = NET.meta, seats = Object.values(NET.seats), host = NET.role==='host', lobby = !!m && m.state!=='playing';
  const ex = (m && m.extra) || [], fl = !!m && roomFloor(m.level), off = offNow();
  // this phone's lobby seat: the owner's from meta, a teammate's from the room's list (its page plays a 樓面 place
  // as the waiter, so NET.myStation reads 'waiter' once a shift has begun)
  const myKey: string = m && host ? hostSeat(m) : mySeat()?.station || NET.myStation || '';
  // the row of the seat this phone sits at reads "（你）" and is lit, for the host as for a teammate
  const who = (k: string): string => {
    if (k===myKey) return `${esc(m && host ? m.hostName : myNick())}（你）`;
    if (m && k===hostSeat(m)) return `${esc(m.hostName)}（老闆）`;
    const s = seats.find(x => x.station===k);
    return s ? esc(s.name) : isLobbyFloor(k) && off.includes(k) ? '熄咗' : '電腦';
  };
  // roles only: 樓面1 and 樓面2 each a seat (a player, the computer or off, as the party
  // lobby's places), the shop's three and the level's own stations; never a 傳菜 / 外賣 seat. Every phone,
  // the owner's too, taps a row's 坐呢度 to move there (a free seat or the computer's; an off place is switched on).
  const lastOn = LOBBY_FLOOR.filter(k => !off.includes(k)).length <= 1;
  const list = (m ? lobbyKeys(m.level, ex) : ['waiter']).map(k => {
    const mine = k===myKey, isOff = isLobbyFloor(k) && off.includes(k), free = !!m && !mine && !heldBy(k, true);
    const sit = free && (host ? lobby : lobby || !isOff) ? `<button type="button" data-seat="${k}">坐呢度</button>` : '';
    const sw = isLobbyFloor(k) && fl && lobby && !heldBy(k) ? `<button type="button" class="sw" data-slot="${k}" data-on="${isOff ? '1' : '0'}"${!isOff && lastOn ? ' disabled' : ''}>${isOff ? '開位' : '熄位'}</button>` : '';
    return `<li class="${mine ? 'mine' : ''}${isOff ? ' off' : ''}" data-k="${k}"><b>${seatName(k)}</b><span>${who(k)}</span>${sit}${sw}</li>`;
  }).join('');
  const rl = m ? rolesLevel(m.level) : null, own = levelRoles(rl).filter(k => !isFloorTask(k)), tasks = levelRoles(rl).filter(isFloorTask);
  const notes = `<p class="hint">${fl ? '熄咗嘅樓面位冇人幫手；電腦嘅位幫手做埋剩低嘅。' : ''}${own.length ? `呢關有${own.map(k => SEAT_NAMES[k]).join('、')}（冇人坐就電腦做）。` : ''}${tasks.length ? `樓面要做埋${tasks.map(k => SEAT_NAMES[k]).join('、')}（喺地圖撳泡泡）。` : ''}${lobby ? '想換位：撳嗰行「坐呢度」。' : ''}</p>`;
  const head = `<div class="sh-head"><b>房號 ${NET.code}</b><span>${online ? '網上' : '未接駁'}</span></div>`;
  if (host){
    v.innerHTML = `${head}${lobby ? modeSwitch('coop', 'room') : ''}<p class="roomcode">${NET.code}</p><p class="hint">${how}</p>
      <ul class="seats">${list}</ul>
      ${notes}
      <p class="hint">揀關卡（組隊用固定間舖，人人一樣）。</p>
      ${levelList(NET.level)}
      <p class="youdo" id="youDo">你開工做：<b>${seatName(NET.hostX || station)}</b></p>
      <button type="button" class="big" id="hostGo">全部人開工</button>
      <button type="button" class="big alt" id="coopLeave">散水（閂房）</button>`;
  } else {
    v.innerHTML = `${head}${m ? `<p class="hint">老闆 ${esc(m.hostName)} · ${m.level && LEVELS[m.level] ? `${lvTag(lvGet(m.level))} ${lvGet(m.level).name}（${SLOTS[lvGet(m.level).slot].name}）` : ''}</p>
      <ul class="seats">${list}</ul>
      ${notes}
      <p class="hint">${myKey ? (m.state==='playing' ? `你坐咗${seatName(myKey)}。老闆開緊工，即刻加入緊……` : `你坐咗${seatName(myKey)}。等老闆開工……`) : m.state==='playing' ? '老闆開緊工：揀個電腦做緊嘅位，即刻加入。' : '揀個位坐低。'}</p>` : '<p class="hint" id="coopMsg">搵緊間房……</p>'}
      <button type="button" class="big alt" id="coopLeave">離開</button>`;
  }
  micCard(v);
}
/** The walkie-talkie's mic row (the request itself is made by the tap that joins or creates the room). */
function micCard(v: HTMLElement): void {
  if (NET.t){
    const fresh = micCardRoom !== NET.code; micCardRoom = NET.code;
    const h = v.querySelector('.sh-head');
    const c = pttLobbyCard(fresh);
    if (h) h.after(c); else v.prepend(c);
  }
}
/**
 * The real mic request on every room entry, inside the entering tap (iOS prompts only from a gesture). A new
 * visit when `fresh` (the tap that created or joined the room); otherwise only the visit's first tap asks.
 */
function askMic(fresh: boolean): void {
  if (!NET.t) return;
  if (fresh) micCardRoom = NET.code;
  pttAskMic(fresh);
}
/** Taking the 傳菜 seat asks for the motion sensors (its tilt control), inside the tap. */
function askMotion(k: string): void { if (k==='runner') void motionAsk(true); }   // once per tab
/**
 * A room whose shift will have 傳菜 (a party night, the level's 傳菜 role for the 樓面's 「傳」, or the
 * 加位 傳菜) asks for motion in the lobby, at a tap there (a teammate's seat or ready tap, the owner's 開工), so the ask
 * never comes mid-play. motionAsk prompts only while the answer is unknown: once per tab.
 */
function roomRunner(): boolean {
  if (NET.night) return true;
  const lv = NET.level && LEVELS[NET.level] ? lvGet(NET.level) : null;
  return levelRoles(lv).includes('runner') || (NET.meta?.extra ?? []).includes('runner');
}
must($('coop'), 'coop').addEventListener('click', e => {
  const b = closestIn(e.target, 'button');
  // a room that came back by itself (a reload) has asked nobody yet: the first tap in its lobby asks
  if (NET.role && !(b && (b.id==='coopLeave' || b.id==='coopClose'))) askMic(false);
  if (NET.role && b && b.id!=='coopLeave' && b.id!=='coopClose' && roomRunner()) void motionAsk(true);   // in the lobby, never mid-play
  if (!b) return;
  if (b.closest('.pty')) return;   // the party screens' own buttons (mountParty)
  // the 組隊 | 派對 switch; on the entry it flips the content, in the owner's lobby the room
  if (b.dataset.mode==='coop' || b.dataset.mode==='party'){
    const md: MpMode = b.dataset.mode; setMpMode(md);
    if (!NET.role){
      const ri = $('roomIn'), typed = ri instanceof HTMLInputElement ? ri.value : '';
      renderCoop();
      const ri2 = $('roomIn'); if (ri2 instanceof HTMLInputElement) ri2.value = typed;   // a code being typed stays
    }
  }
  if (b.id==='partyOpen' && NET.role==='host') partySend({ t:'partyOpen', name: myNick() });
  if (b.id==='partyClose' && NET.role==='host') partySend({ t:'partyClose' });
  if ((b.id==='hostBtn' || b.id==='joinBtn') && !netOnline()){ toast('組隊要上網先玩得'); return; }
  if (b.id==='hostBtn'){ const party = mpMode()==='party'; hostRoom(); partyWanted = party; askMic(true); }
  if (b.id==='joinBtn'){
    const ri = $('roomIn');
    if (!(ri instanceof HTMLInputElement)) throw new TypeError('chakei: #roomIn is not an input');
    const c = ri.value.trim(); if (c.length===4){ joinRoom(c); askMic(true); } else toast('房號係四個字');
  }
  if (b.dataset.seat) askMotion(b.dataset.seat);
  if (b.id==='coopClose'){ must($('coopView'), 'coopView').hidden = true; }
  if (b.id==='coopLeave'){ netLeave(); renderCoop(); }
  if (b.id==='hostGo') hostStart();
  // the owner and every teammate move by tapping a seat's 坐呢度 (the owner no longer goes back to the start screen)
  if (b.dataset.seat){
    const k = seatKey(b.dataset.seat);
    if (k){ if (NET.role==='host') hostSit(k); else pickSeat(k); if (isExtraKind(k) && (NET.myStation===k || (NET.role==='host' && NET.hostX===k))) untrainedWarn(k); }
  }
  if (b.dataset.slot && isLobbyFloor(b.dataset.slot)) floorSlot(b.dataset.slot, b.dataset.on==='1');
  if (b.dataset.lv && NET.role==='host'){
    // the next level's own stations replace the seats; a teammate sitting at one it does not have stays put (a
    // teammate on 樓面 or the waiter's seat moves to the next level's floor seat by itself: migrateSeat)
    const ex = roomExtras(b.dataset.lv), out = Object.values(NET.seats).find(s => isExtraKind(s.station) && !ex.includes(s.station));
    if (out){ toast(`${out.name}坐咗${seatName(out.station)}，呢關冇呢個位`); return; }
    NET.level = b.dataset.lv; pushMeta('lobby'); renderCoop();   // pushMeta's hostFix moves the owner's seat with the level
  }
});
/** A seat key from a lobby button (renderCoop draws them from lobbyKeys), or null. */
const seatKey = (k: string): Exclude<LobbySeat, ''> | null => isLobbyFloor(k) || isExtraKind(k) ? k : Object.prototype.hasOwnProperty.call(STATIONS, k) ? stationOf(k) : null;
/**
 * The owner taps a seat in the lobby and sits there: a seat no teammate holds (the computer's, or an off 樓面
 * place, which sitting switches on). Mid-shift the owner moves with the strip's 換做 / 返做 (hostSwitch).
 */
export function hostSit(k: Exclude<LobbySeat, ''>): void {
  const m = NET.meta; if (!m || NET.role!=='host') return;
  if (m.state==='playing'){ toast('開緊工：用上面嘅「換做」換位'); return; }
  if (mateAt(k)){ toast('呢個位有人'); return; }
  if (isLobbyFloor(k) || isExtraKind(k)) NET.hostX = k; else { NET.hostX = ''; setStation(k); }
  pushMeta('lobby'); renderCoop();
}
/**
 * The owner picked a level with or without 樓面: a teammate at a 樓面 place (or the waiter's seat) moves to the
 * new level's equivalent by itself (the first free place, or the waiter's seat), or stands up if it is taken.
 */
function migrateSeat(m: NetMeta): void {
  const k = mySeat()?.station; if (!k || m.state==='playing' || m.party) return;
  if (lobbyKeys(m.level, m.extra ?? []).includes(k) || !(k==='waiter' || isLobbyFloor(k))) return;
  const to = roomFloor(m.level) ? LOBBY_FLOOR.find(x => !heldBy(x, true)) : !heldBy('waiter', true) ? 'waiter' : undefined;
  if (to) pickSeat(to, true);
  else { NET.myStation = ''; must(NET.t, 'NET.t').setSeat(null); toast('呢關冇你個位：揀過個位坐低'); }
}
/** A seat this phone has not learned (員工培訓) may still be taken in a room; it only says so. */
function untrainedWarn(k: ExtraKind): void { if (!xTrained(k)) toast(`你未學過${SEAT_NAMES[k]}：照坐得，唔識可以先去「員工培訓」學`); }
/**
 * The host moves seats during the shift (the strip's 換做 / 返做 buttons, src/ui/seat.ts): to extra seat `k` the
 * computer runs, or ('') back to their shop station: on a 樓面 level a floor seat the computer runs. Their
 * old seat goes to the computer; the next shift starts at the extra seat too.
 */
export function hostSwitch(k: ExtraKind | ''): void {
  if (NET.role!=='host' || !phone() || !G || !G.running) return;
  const home = stationOf(G.station), from = seatIdNow() || seatFor(NET.myStation || home), to = k || homeSeat();
  if (!to || to===from || Reflect.get(G.roles, to)!=='ai') return;
  ptMove(); release(from); claim(to);   // the room's referee hands the seats over; the grant brings the seat's state
  NET.myStation = k || home; NET.hostX = k; pushMeta('playing');
  if (!k){ showStation(home); if (typeof applyView==='function') applyView(); }
  showSeat(k, NET.id);
  toast(`你而家做${seatLabel(to)}`);
}
setSeatSwitcher(() => NET.role==='host');
must($('xStrip'), 'xStrip').addEventListener('click', e => {
  const b = closestIn(e.target, 'button'); if (!b || b.dataset.sw===undefined) return;
  const k = b.dataset.sw, x = isExtraKind(k) ? k : '';
  // the room's owner moves through the room; a phone that is its own referee (a solo seat or a level's stations)
  // moves at once (it used to show the buttons and do nothing)
  if (NET.role==='host') hostSwitch(x); else if (soloSeatOn()) soloSwitch(x);
});
must($('coopBtn'), 'coopBtn').onclick = () => { renderCoop(); must($('coopView'), 'coopView').hidden = false; void checkStale(true); };
// 閂頁／重新載入：唔講再見，淨係斷線。房會留返個位 15 秒（重新載入就坐返）；老闆走咗 6 秒就由朋友接手
addEventListener('pagehide', () => { if (NET.role && phone()) away('pagehide'); if (NET.t) NET.t.drop(); });
// 重新載入之前喺房入面做朋友：自動入返同一間房、坐返同一個位
addEventListener('load', () => {
  let r: unknown = null; try { r = netJson(sessionStorage.getItem('ckf-room') || 'null'); } catch { /* storage blocked or not JSON */ }
  netTrustRoom(r);
  if (!r || !r.code) return;
  const room = r;
  void cloudReady.then(() => { if (!netOnline()) return; joinRoom(room.code, room.st); renderCoop(); must($('coopView'), 'coopView').hidden = false; });
});

/* ===================== 派對夜：間房行成晚，呢部機淨係畫畫面、傳撳咗乜 ===================== */
// The room's Durable Object keeps the night (core/coop/room-party.ts) and starts each round's shift; this phone draws the
// night's screens (ui/party mountParty) in the room view, sends its presses (the room stamps who), sits at the seat the
// night gives it (a round's keyframe then starts the shift here as in any room) and shows the night's own end card.
/** The party screens on this phone while a night is open, and the element they live in (kept across renderCoop). */
export let partyUi: PartyMount | null = null;
export const partyEl = document.createElement('div');
partyEl.className = 'pty-room';
/** The last night received (the screens may ask once more after it was closed). */
export let partyLast: NetNight | null = null;
/** When this phone last asked to join the night: again every 3 s until the night lists it as here. */
export let partyJoinAt = -1e9;
/** The difficulty in force before a party round set the party's pace (back on a plain shift or on leaving). */
export let partyPrevDiff: string | null = null;
export function partySend(m: Extract<NetOut, { t: 'partyOpen' | 'partyClose' | 'party' }>): void { if (NET.t) NET.t.partySend(m); }
/** A party round's pace from its keyframe (the shared `party`), or the game's own again (null, or a plain shift). */
export function partyPace(v: unknown): void {
  const p = partyOf(v);
  if (p){ if (partyPrevDiff===null) partyPrevDiff = diff; installParty(p); }
  else if (partyPrevDiff!==null){ installParty(null); setDiff(partyPrevDiff); partyPrevDiff = null; }
}
export function partyUnmount(): void { if (partyUi){ partyUi.destroy(); partyUi = null; } }
/** The room's party message: a refusal of this phone's press, or the night (null: it was closed). */
export function partyIn(m: NetParty): void {
  if (m.why) toast(rejectText(m.why));
  if (!('night' in m)) return;
  NET.night = m.night ?? null;
  if (NET.night) partyLast = NET.night;
  partySync();
}
// a shop station, or one of the party shop's extra stations (party nights seat the shop's `roles`); 樓面's party
// seats play the waiter's screens on the floor, as a co-op floor seat does
const partySeat = (k: string | null | undefined): StationId | ExtraKind | '' => isExtraKind(k) ? k : k && /^floor\d$/.test(k) ? 'waiter' : k && Object.prototype.hasOwnProperty.call(STATIONS, k) ? stationOf(k) : '';
/** Follows the night: join it, sit where it says (mid-round too), and redraw its screens. */
export function partySync(): void {
  const s = NET.night;
  if (!s){ if (partyUi){ partyUnmount(); NET.myStation = ''; renderCoop(); } return; }
  const me = s.players.find(p => p.id===NET.id), now = performance.now();
  if ((!me || !me.present) && now - partyJoinAt > 3000){ partyJoinAt = now; partySend({ t:'party', ev: { k:'join', name: myNick() } }); }
  const seat = me && me.present ? partySeat(me.seat) : '';
  if (seat !== NET.myStation){
    NET.myStation = seat; claimedRound = -1;
    // mid-round: a new seat is claimed from here (netFrame), the old one the room gave the computer; no seat: watch
    if (G && G.coop && G.running && s.phase==='round'){ if (seat){ if (!isExtraKind(seat)) setStation(seat); clientBegin(); } else partyShow(); }
  }
  // the room's own buttons under the screens change only with the owner's lobby duty and the phase (a full redraw
  // would move the screens out from under a finger at the clock's 4 Hz)
  if (partyUi && partyRow===partyRowOf(s)) partyUi.update(); else renderCoop();
}
/** The room view with the night's screens on top of the shop. */
export function partyShow(): void {
  const b = $('bossSay'); if (b) b.hidden = true;   // the shift's 組隊開工 bubble stays with the shift
  renderCoop(); must($('coopView'), 'coopView').hidden = false;
}
/** The room's buttons under the screens as drawn: 'owner' / 'owner+close' (back to plain shifts) / 'player'. */
export let partyRow = '';
const partyRowOf = (s: NetNight): string => NET.role!=='host' ? 'player' : s.phase==='lobby' || s.phase==='done' ? 'owner+close' : 'owner';
/** The room view while a night is open: its screens, then leave (everyone) and back to plain shifts (the owner, between nights). */
function renderParty(v: HTMLElement, s: NetNight): void {
  partyRow = partyRowOf(s);
  const owner = NET.role==='host', canClose = partyRow==='owner+close';
  // the owner's 組隊 | 派對 switch (between nights only)
  v.innerHTML = `<div class="sh-head"><b>房號 ${NET.code}</b><span>派對夜</span></div>${canClose ? modeSwitch('party', 'room') : ''}`;
  v.append(partyEl);
  const row = document.createElement('div');
  row.innerHTML = `<button type="button" class="big alt" id="coopLeave">${owner ? '散水（閂房）' : '離開'}</button>`;
  v.append(row);
  if (!partyUi) partyUi = mountParty(partyEl, { input: ev => { partySend({ t:'party', ev: { ...ev } }); return undefined; }, night: () => NET.night ?? partyLast ?? s }, NET.id);
  else partyUi.update();
}
// A party round ends on the night's end card (the room sends it once the books close), not the game's own.
setEndHook(() => { if (!NET.night || !G || !G.party) return false; partyShow(); return true; });
/* ===================== 連線狀態（右上角細字：延遲、斷線） ===================== */
export function netBadge(): void {
  let el = $('netBadge');
  if (!NET.t){ if (el) el.hidden = true; return; }
  if (!el){ el = document.createElement('div'); el.id = 'netBadge'; el.className = 'netbadge'; document.body.appendChild(el); }
  el.hidden = false;
  const down = !NET.t.up, ms = NET.t.rtt, shaky = NET.t.quiet;
  el.dataset.st = down ? 'down' : shaky || ms > 250 ? 'slow' : 'ok';
  el.textContent = down ? '斷線，駁緊……' : shaky ? '連線唔穩……' : `${NET.role==='host' ? '老闆' : '組隊'} ${NET.code} · ${ms ? `${ms}ms` : '…'}`;
}
setInterval(() => { if (NET.t) netBadge(); }, 2000);
