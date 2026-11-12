// The shift's state `G` and what the rules read about the shop around it.
import { must } from './util';
import { DIFFS, CFG } from './data/menus';
import { PORT } from './env';

// 預設六張枱；裝修買咗枱會喺 decor.js 重新整過
export let TABLES: Table[] = [
  { name:'一號卡', cap:4, kind:'booth' }, { name:'二號卡', cap:4, kind:'booth' },
  { name:'三號卡', cap:4, kind:'booth' }, { name:'四號卡', cap:4, kind:'booth' },
  { name:'五號枱', cap:2, kind:'small' }, { name:'六號枱', cap:2, kind:'small' },
];
export function setTABLES(v: typeof TABLES): void { TABLES = v; }
export let slot: Slot = 'lunch';
export function setSlot(v: typeof slot): void { slot = v; }
// 熟客幾時嚟由 career.js planVisitors 每更隨機決定（罕有啲）
export const REG_PLAN: Visit[] = [];
export let diff = 'pro';
export function setDiff(v: typeof diff): void { diff = v; }
export let station: StationId = 'waiter';
export function setStation(v: typeof station): void { station = v; }
export const D = (): Difficulty => must(DIFFS[diff], 'difficulty ' + diff);
/* ===================== 一間舖嘅規則（唔理畫面） =====================
   每個位都係一個角色：'me' 係你，'ai' 係電腦補位。
   將來組隊：朋友頂替 'ai' 就得，規則唔使改。                      */
export let G: GameState | null = null;
export function setG(v: typeof G): void { G = v; }
/** G during a shift. Every caller ran with a shift in the JS too (it read G.something straight away). */
export const liveG = (): GameState => must(G, 'G (no shift running)');
export function newGame(): void {
  G = { slot, station, roles:{ waiter: station==='waiter' ? 'me' : 'ai', bar: station==='bar' ? 'me' : 'ai', kitchen: station==='kitchen' ? 'me' : 'ai', till: station==='till' ? 'me' : 'ai' },
        phase: station==='bar' ? 'prep' : 'open', rt:0, cups:0,
        pot:{ level: station==='bar' ? 0 : PORT.potCap(), st: station==='bar' ? 'empty' : 'ready', until:0, pulls:0 },
        ab:{ cur:null, until:0 }, bench:{ target:null, cup:null, ing:{} },
        kit:{ pot:[null,null], pan:[null,null], toaster:[null], oven:[null], wok:[null] }, plates: Array.from({ length: kitPlateN() }, () => ({ target:null, tokens:[] })), ksel:null, hold:[], pi:0, dishes:0,
        t:0, running:true, paused:false, groups:[], payQ:[], tables: TABLES.map((tb,i) => ({ ...tb, id:i, dirty:0 })),
        nextSpawn:1.5, nextId:1, colorIx:0, revenue:0, loss:0, angry:0, mistakes:0, served:0, paidCount:0,
        regHit:0, regMiss:0, regSeen:{}, regPlan: REG_PLAN.map(r => ({ ...r })), selected:null, ver:1, sheet:null, board:false,
        aw:{ job:null, until:0 }, at:{ cur:null, until:0 },
        cur:null, step:'total', entry:'', give:[], charged:0, paid:0, nextCust:0, lastCust:null };
}
// me = 呢個位有真人做（自己或者隊友）；local = 自己部機做緊呢個位
export const me = (role: StationId): boolean => liveG().roles[role] !== 'ai';
export const local = (role: StationId): boolean => liveG().roles[role]==='me';
export const activePlate = (): GameState['plates'][number] | undefined => { const S = liveG(); return S.plates[S.pi]; };
// Set while this phone is a referee (core/coop/referee.ts). Off (solo, and co-op still on the old net path in
// src/net/net.ts, where the host runs every station on teammates' taps), every station runs here as before.
let refOn = false;
export function setRefOn(v: boolean): void { refOn = v; }
/** This phone runs the station (a player here, or the computer on the referee's phone): not a teammate's. */
export const drivesHere = (role: StationId): boolean => !refOn || liveG().roles[role] !== 'remote';
// 廚房碟數：一開始一隻，升到熟手先有第二隻（培訓都係一隻）
export const kitPlateN = (): number => PORT.rankIx() >= 2 ? CFG.plates : 1;
export const bump = (): void => { liveG().ver++; };
export const byId = (id: number): Group | undefined => { const S = liveG(); return S.groups.find(g => g.id===id) || S.payQ.find(c => c.id===id); };
export const atTable = (id: number): Group[] => liveG().groups.filter(g => g.table===id);
export const occupied = (id: number): number => atTable(id).reduce((a,g) => a + g.size, 0);
/** G.tables[ix], where the JS read a field of it straight away (so a missing table threw there too). */
export const tableAt = (ix: number | null): TableState => must(ix === null ? undefined : liveG().tables[ix], 'table ' + String(ix));
/** The level being played, if any (the JS wrote `G && G.level && LEVELS[G.level]`). */
export const curLevel = (): Level | undefined => G?.level ? PORT.level(G.level) : undefined;
/**
 * A group that sits down (not a takeaway customer). Only seated groups reach the door, the floor, the order sheet and
 * the till; the JS read their seated-only fields unchecked, and a takeaway group there would have thrown or misbehaved.
 */
export function asSeat(g: Group): SeatGroup {
  if (g.take) throw new TypeError('chakei: takeaway customer where a seated group was expected');
  return g;
}
// Results carry the time they happened (COOP_MODEL): a teammate's tap is stamped with its phone's game clock (a.t), and
// time-judged steps (kitchen.ts kitStart / kitTake: cooked yet? burnt?) use that time, so the host decides exactly what the
// teammate saw instead of re-judging on its own clock (which may be ahead or behind by the lag, or by a slow frame rate).
// Clamped to NET_T_SLACK game seconds of the host's clock, so a wrong phone clock cannot cheat.
export let netActT: number | null = null;
export function setNetActT(v: typeof netActT): void { netActT = v; }
export const NET_T_SLACK = 1.5;
export function netNow(): number { const S = liveG(); return netActT != null ? Math.max(S.t - NET_T_SLACK, Math.min(S.t + NET_T_SLACK, netActT)) : S.t; }
