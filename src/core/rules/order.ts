// What customers order and how they say it. Every draw takes the stream `r` (core/rng.ts).
import { SETS, NOODLES, EGGS, DEF, DISHES, DFLAGS, DRINKS, FOODS, HAT_OK, HAT_TXT, isIced, isHot, SWEET, COSTUME, SIG_ASK } from '../data/menus';
import { pickSure, rnd, rng, type Rng } from '../rng';
import { PORT } from '../env';
import { curLevel, slot, G } from '../state';
import { must } from '../util';
import { drinkKey, foodId, itemRecipeKey } from './price';

export const clonePerson = (p: Person): Person => ({ food:p.food, set: p.set ? { ...p.set } : null, dish: p.dish ? { ...p.dish } : null, drink:{ ...p.drink } });
/* ---- 客人點講嘢 ---- */
export function randSet(r: Rng = rng): SetOrder {
  const bread = r() < .6 ? '牛油多士' : r() < .6 ? '奶油多士' : '餐包';
  const hongdai = bread==='餐包' && r() < .5;   // 烘底係軟餐包嘅要求（+$2）；多士本身已經烘過，唔叫烘底；餐包烘底後先可以飛邊
  return { id: wpick(OPEN(SETS, 's'), 's', r).id,
           noodle: r() < .45 ? '通粉' : pickSure(NOODLES.slice(1), r),
           egg: r() < .45 ? '煎蛋' : pickSure(EGGS.slice(1), r),
           bread, hongdai, feibin: (bread!=='餐包' || hongdai) && r() < .2 };
}
export function saySet(st: SetOrder, r: Rng = rng): string {
  const parts = [st.id];
  if (st.noodle!==DEF.noodle) parts.push(pickSure(['轉','要',''], r) + st.noodle); else if (r() < .25) parts.push('通粉');
  if (st.egg!==DEF.egg) parts.push(st.egg); else if (r() < .25) parts.push('煎蛋');
  const tail = (st.hongdai ? '烘底' : '') + (st.feibin ? '飛邊' : '');
  if (st.bread==='餐包') parts.push(tail ? '餐包' + tail : '轉餐包');
  else if (st.bread==='奶油多士') parts.push('奶油多士' + tail);
  else if (tail) parts.push('多士' + tail);
  return parts.join('，');
}
export function randDish(r: Rng = rng): DishOrder {
  const d = wpick(OPEN(DISHES, 'd'), 'd', r), o: DishOrder = { id:d.id, 炒底:false, 加底:false, 走青:false };
  if (d.sauce && r() < .35) o.炒底 = true;
  if (r() < .25) o.加底 = true;
  if (r() < .3) o.走青 = true;
  return o;
}
export function sayDish(o: DishOrder, r: Rng = rng): string {
  const fl: string[] = DFLAGS.filter(f => o[f]);
  if (r() < .5) fl.reverse();
  return [o.id, ...fl].join(r() < .5 ? '，' : '');
}
export function randDrink(r: Rng = rng): DrinkOrder {
  const fd = curLevel()?.favorDrink;   // 關卡招牌飲品：一半人叫
  const d = must(fd && r() < .5 ? DRINKS.find(x => x.id===fd) : wpick(OPEN(DRINKS, 'k'), 'k', r), 'drink ' + String(fd)), cold = d.iced || (!d.hot && r() < .6);
  return { d: d.id, cold, sweet: !cold || d.sw ? 0 : r() < .3 ? 1 : r() < .15 ? 2 : 0, noice: cold && !d.iced && r() < .3 };
}
export function randPerson(r: Rng = rng): Person {
  if (slot==='dinner') return { food:null, set:null, dish: r() < .92 ? randDish(r) : null,
           drink: randDrink(r) };
  if (slot==='breakfast') return { food:null, set: r() < .88 ? randSet(r) : null,
           drink: randDrink(r) };
  const foodP = curLevel()?.foodP || .9;   // 大牌檔好多人淨係飲嘢
  const fav = curLevel()?.favor;   // 關卡招牌菜：一半人叫
  let food: string | null = r() < foodP ? (fav && r() < .5 ? fav : wpick(OPEN(FOODS, 'f'), 'f', r).id) : null;
  if (food && HAT_OK.includes(food) && r() < .45) food += HAT_TXT;
  return { food,
           drink: randDrink(r) };
}
export function sayDrink(d: DrinkOrder, r: Rng = rng): string {
  let base = isIced(d.d) || isHot(d.d) ? d.d : (d.cold ? '凍' : (r() < .5 ? '熱' : '')) + d.d;
  // 茶記講法：「凍檸」即係凍檸茶（培訓唔用，等新手唔使估）
  if (d.d==='檸茶' && d.cold && !G?.tut && r() < .4) base = '凍檸';
  return base + (SWEET[d.sweet|0] ?? '') + (d.noice ? '走冰' : '');
}
export const sayPerson = (p: Person, r: Rng = rng): string => (p.food ? p.food.replace(' ', '') + '，' : '') + (p.set ? saySet(p.set, r) + '，' : '') + (p.dish ? sayDish(p.dish, r) + '，' : '') + sayDrink(p.drink, r);
export function genOrder(n: number, r: Rng = rng): { persons: Person[]; lines: string[] } {
  const ps: Person[] = [], lines: string[] = [];
  for (let i = 0; i < n; i++){
    if (i > 0 && r() < .22){ ps.push(clonePerson(must(ps[i-1], 'previous person'))); lines.push(pickSure(['我一樣。','我都係一樣。'], r)); continue; }
    const p = randPerson(r); ps.push(p);
    lines.push((i===0 ? '唔該，' : pickSure(['我要','我','佢要','我叫'], r)) + sayPerson(p, r) + '。');
  }
  // 有時會改單：將一杯熱飲改凍（只揀獨一無二嗰杯，唔會含糊）
  if (r() < .2){
    const i = ps.findIndex(p => !p.drink.cold && !isHot(p.drink.d) && ps.filter(q => q.drink.d===p.drink.d).length===1);
    if (i >= 0){
      const p = must(ps[i], 'person'), old = drinkKey(p.drink);
      p.drink.cold = true;
      lines.push(`啊唔好意思，${n>1?'嗰杯':'杯'}${old.slice(1)}改凍。`);
    }
  } else if (slot==='breakfast' && r() < .25){
    const i = ps.findIndex(p => { const s = p.set; return !!s && ps.filter(q => q.set && q.set.id===s.id).length===1; });
    if (i >= 0){
      const st = must(must(ps[i], 'person').set, 'set'), to = pickSure(EGGS.filter(e => e!==st.egg), r);
      st.egg = to;
      lines.push(`啊，${n>1?'個':''}${st.id}改${to}。`);
    }
  } else if (slot==='dinner' && r() < .25){
    const i = ps.findIndex(p => { const s = p.dish; return !!s && !s.走青 && ps.filter(q => q.dish && q.dish.id===s.id).length===1; });
    if (i >= 0){ const dish = must(must(ps[i], 'person').dish, 'dish'); dish.走青 = true; lines.push(`啊，${n>1?'個':''}${dish.id}走青呀。`); }
  }
  return { persons: ps, lines };
}
export function groupKind(size: number, r: Rng = rng): { label: string; noShare?: boolean } {
  const LV = curLevel();
  if (LV && LV.costume) return { label: pickSure(must(COSTUME[size], `costumes for ${size}`), r) + (size===1 ? pickSure(['後生仔','OL','阿伯'], r) : ''), noShare: size===2 && r() < .3 };
  if (size===1) return { label: pickSure(LV && LV.nightLabels ? LV.nightLabels : slot==='breakfast' ? ['地盤佬','晨運伯伯','OL','返工族','學生哥','的士佬'] : slot==='dinner' ? ['放工OL','夜更的士佬','地盤佬','補習學生','獨居阿伯'] : ['地盤佬','阿伯','OL','的士佬','學生仔','阿姐'], r) };
  if (size===2) return r() < .35 ? { label:'情侶', noShare:true } : { label: pickSure(['兩個同事','兩個阿婆','兩個學生'], r) };
  if (size===3) return { label: pickSure(['三個學生','三個同事'], r) };
  return { label: pickSure(slot==='dinner' ? ['一家四口','四個同事','兩代人'] : ['一家四口','四個同事'], r) };
}
export function randSize(r: Rng = rng): number { const x = r();
  // 關卡可以自訂幾多人一枱（sizes = 一人、兩人、三人嘅累計機會，其餘四人）
  const L = curLevel();
  if (L && L.sizes) return x <  L.sizes[0] ? 1 : x <  L.sizes[1] ? 2 : x <  L.sizes[2] ? 3 : 4;
  if (slot==='dinner') return x <  .2 ? 1 : x <  .55 ? 2 : x <  .75 ? 3 : 4;
  const one = slot==='breakfast' ? .58 : .4; return x <  one ? 1 : x <  one + .3 ? 2 : x <  one + .4 ? 3 : 4; }
// 每個客諗嘢快慢唔同：熟客、趕返工嘅快；阿伯阿婆、學生哥、情侶慢
export function thinkF(g: SeatGroup, r: Rng = rng): number {
  if (g.regular || g.celeb) return g.repeat ? .3 : .6;
  const l = g.label || '';
  if (/伯|婆/.test(l)) return rnd(1.6, 2.6, r);
  if (/學生|情侶/.test(l)) return rnd(1.2, 2, r);
  if (/地盤|的士|OL|返工/.test(l)) return rnd(.5, .9, r);
  return rnd(.8, 1.4, r);
}
export const OPEN = <T extends { id: string }>(list: readonly T[], ns: string): T[] => { const o = list.filter(x => PORT.menuOpen(ns + ':' + x.id)); return o.length ? o : [...list]; };
// 一個客叫嘅嘢係咪全部識整（熟客叫唔到就唔嚟）
export const orderOpen = (persons: Person[]): boolean => persons.every(p => (!p.food || PORT.menuOpen('f:' + foodId(p.food))) && (!p.set || PORT.menuOpen('s:' + p.set.id)) && (!p.dish || PORT.menuOpen('d:' + p.dish.id)) && PORT.menuOpen('k:' + p.drink.d));
// 招牌菜（三星）只喺自己間舖有人專登叫、會讚；關卡用返原本餐牌
export const isSig = (k: string): boolean | null => PORT.inMyShop() && PORT.recipeLv(itemRecipeKey(k)) >= 3;
// g.items is always set (makeGroup / makeTake), so the JS's `g.items || []` fallback is gone.
export function sigLine(g: SeatGroup, r: Rng = rng): void {
  const k = g.items.find(isSig); if (!k || r() > .5) return;
  g.lines.push(pickSure(SIG_ASK, r)(PORT.fancyName(itemRecipeKey(k))));
}
// 升咗級嘅菜多啲人叫（二星 1.5 倍、三星兩倍）
// The list is never empty (OPEN falls back to the whole menu); the caller read `.id` of the result straight away.
export function wpick<T extends { id: string }>(list: readonly T[], ns: string, r: Rng = rng): T {
  if (!PORT.inMyShop()) return pickSure(list, r);
  const w = list.map(x => 1 + (PORT.recipeLv(ns + ':' + x.id) - 1) * .5), sum = w.reduce((a, b) => a + b, 0);
  let x = r() * sum; for (let i = 0; i < list.length; i++){ x -= w[i] ?? NaN; if (x <= 0) return must(list[i], 'weighted pick'); }
  return must(list[list.length - 1], 'weighted pick');
}
