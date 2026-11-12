// Connects the shop's rules (src/core/) to the page. core/ has no DOM, no save and
// no Math.random, so at load the page gives it three things:
// - the port (core/env.ts): what the rules read from the player's progress (levels, menu, recipe levels, sets, rank,
//   regulars' visits) and the bookkeeping the save does when a regular arrives or pays;
// - the effect sink (core/fx.ts): every toast, sound, float, redraw and the end card the rules emit, played the moment it
//   is emitted, so effects keep their order and run under the same co-op netActing as the call that caused them;
// - the random stream (core/rng.ts), seeded once from Math.random: the only place the page's rules touch Math.random.
// Late in the load order (after share, before main): every module it reaches into has run by then, and no earlier module
// runs the rules at load (main draws the backdrop shift, after this).
import './share';   // load order: src/entry.ts
import { setPort } from '../core/env';
import { setFxSink, type Fx } from '../core/fx';
import { setRng, mulberry32 } from '../core/rng';
import { must } from '../core/util';
import { LEVELS } from './levels';
import { menuOpen, shopLunchKit } from './menu';
import { inMyShop, rLv, fancyName } from './market';
import { setPat, setTip, setBoost, potCap, placeFx, setOn } from './sets';
import { rankIx, regArrive, regPaid } from './career';
import { SHOP } from './decor';
import { toast, say, floatAt, shake } from './ui';
import { sfx, showCombo, feverFx, twistFx, ambient } from './juice';
import { sheetOpened, sheetChanged } from './waiter';
import { renderPad } from './till';
import { $ } from './prefs';
import { endCard } from './main';

setPort({
  level: id => LEVELS[id], menuOpen, inMyShop: () => !!inMyShop(), recipeLv: rLv, fancyName,
  setPat, setTip, setBoost, potCap, placeFx, setOn, rankIx: () => rankIx(),
  regVisits: k => (must(SHOP.regs, 'SHOP.regs')[k] ?? 0)|0, regArrive, regPaid, lunchKit: shopLunchKit,
});

/** Plays one sound of the rules' (core/fx.ts SfxName); `n` is the combo for 'good', the pitch for 'blup'. */
function playSfx(name: Extract<Fx, { k: 'sfx' }>['name'], n: number | undefined): void {
  if (name === 'good') sfx.good(n ?? 0);
  else if (name === 'blup') sfx.blup(n);
  else sfx[name]();
}
export function playFx(e: Fx): void {
  switch (e.k){
    case 'toast': toast(e.msg); break;
    case 'say': say(e.role, e.msg); break;
    case 'float': floatAt(e.table, e.text, e.color); break;
    case 'shake': shake(e.table); break;
    case 'sfx': if (e.delay) setTimeout(() => { playSfx(e.name, e.n); }, e.delay); else playSfx(e.name, e.n); break;
    case 'combo': showCombo(e.tip, e.broke); break;
    case 'fever': feverFx(e.on); break;
    case 'twist': twistFx(e.twist, e.on); break;
    case 'ambient': ambient(e.level); break;
    case 'sheetOpen': sheetOpened(e.gid, e.lemon); break;
    case 'sheet': sheetChanged(e.open); break;
    case 'boardClosed': must($('boardWrap'), 'boardWrap').hidden = true; break;
    case 'pad': renderPad(); break;
    case 'end': endCard(); break;
  }
}
setFxSink(playFx);

setRng(mulberry32(Math.floor(Math.random() * 2 ** 32)));
