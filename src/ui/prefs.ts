// The page side of the original game's rules.js: the shop's rules themselves live in src/core/ (no DOM, no storage),
// and this module keeps the page's part at the same place in the load order: the player's last station, time slot and
// difficulty, read from localStorage into core/state.ts before any later module reads them, and the `$` lookup.
import './taste';   // load order: src/entry.ts
import { ownKey } from '../core/util';
import { SLOTS, STATIONS, DIFFS } from '../core/data/menus';
import { setSlot, setStation, setDiff } from '../core/state';

try { const v = localStorage.getItem('ckf-slot'); if (ownKey(SLOTS, v)) setSlot(v); } catch { /* storage blocked: keep the default */ }
try { const v = localStorage.getItem('ckf-station'); if (ownKey(STATIONS, v)) setStation(v); } catch { /* storage blocked: keep the default */ }
try { const d = localStorage.getItem('ckf-diff'); if (d !== null && DIFFS[d]) setDiff(d); } catch { /* storage blocked: keep the default */ }
export const $ = (id: string): HTMLElement | null => document.getElementById(id);
