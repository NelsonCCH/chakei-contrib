// What an order is called and what it costs.
import { SWEET, DFLAGS, HAT_TXT, isIced, isHot, DRINKS, FOODS, HAT_P, SETS, CFG, DISHES, GADAI } from '../data/menus';
import { must } from '../util';

/* ---- 單上面嘅寫法 ---- */
export const drinkKey = (d: DrinkOrder): string => (d.cold?'凍':'熱') + d.d + (SWEET[d.sweet|0] ?? '') + (d.cold && d.noice ? '走冰':'');
export const dishKey = (d: DishOrder): string => 'd' + d.id + DFLAGS.filter(f => d[f]).join('');
export const setKey = (st: SetOrder): string => 's' + [st.id, st.noodle, st.egg, st.bread + (st.hongdai ? '烘底' : '') + (st.feibin ? '飛邊' : '')].join(' ');
export function itemsOf(persons: Person[]): string[] {
  const out: string[] = [];
  for (const p of persons){ if (p.food) out.push('f'+p.food); if (p.set) out.push(setKey(p.set)); if (p.dish) out.push(dishKey(p.dish)); out.push(drinkKey(p.drink)); }
  return out;
}
export const foodId = (f: string): string => f.replace(HAT_TXT, '');
export const label = (k: string): string => isMeal(k) ? k.slice(1) : (k[0]==='凍' && isIced(must(drinkOf(k), 'drink in ' + k).id)) || (k[0]==='熱' && isHot(must(drinkOf(k), 'drink in ' + k).id)) ? k.slice(1) : k;
/* ===================== 單嘅價錢 ===================== */
// 一個餐跟一杯飲品（凍飲照加錢）；飲品多過餐，多出嚟嗰幾杯收全價
export const isMeal = (k: string): boolean => { const c = k[0]; return c==='f' || c==='s' || c==='d'; };
export const drinkOf = (k: string): DrinkDef | undefined => DRINKS.filter(d => k.includes(d.id)).sort((a, z) => z.id.length - a.id.length)[0];
   // 揀最長嗰個（長名嘅飲品唔好當咗短名嗰個）
export function mealPrice(k: string): number {
  if (k[0]==='f') return must(FOODS.find(f => f.id===foodId(k.slice(1))), 'food ' + k).p + (k.includes(HAT_TXT) ? HAT_P : 0);
  if (k[0]==='s'){ const [id, noodle, , bread] = k.slice(1).split(' '); return must(SETS.find(x => x.id===id), 'set ' + k).p + (noodle==='公仔麵' ? CFG.dingExtra : 0) + (must(bread, 'bread in ' + k).includes('烘底') ? CFG.hongExtra : 0); }
  return must(DISHES.find(x => k.startsWith('d'+x.id)), 'dish ' + k).p + (k.includes('加底') ? GADAI : 0);
}
export function priceSlip(keys: string[]): { lines: { k: string; price: number; tag: string }[]; total: number } {
  let meals = keys.filter(isMeal).length;
  const lines = keys.map(k => {
    if (isMeal(k)) return { k, price: mealPrice(k), tag:'' };
    const cold = k[0]==='凍' ? CFG.coldExtra : 0;
    if (meals > 0){ meals--; return { k, price: cold, tag:'跟餐' }; }
    return { k, price: must(drinkOf(k), 'drink ' + k).p + cold, tag:'單叫' };
  });
  return { lines, total: lines.reduce((a, l) => a + l.price, 0) };
}
// 單上面邊幾行係客人根本冇叫過（伙記寫多咗）
export const baseOf = (k: string): string => k[0]==='s' ? must(k.split(' ')[0], 'set id') : k[0]==='d' ? 'd' + must(DISHES.find(x => k.startsWith('d'+x.id)), 'dish ' + k).id : k[0]==='f' ? 'f' + foodId(k.slice(1)) : 'k' + must(drinkOf(k), 'drink ' + k).id;
export function disputes(ordered: string[], slip: string[]): number[] {
  const pool = ordered.map(baseOf), out: number[] = [];
  slip.forEach((k, i) => { const j = pool.indexOf(baseOf(k)); if (j >= 0) pool.splice(j, 1); else out.push(i); });
  return out;
}
export function grade(expected: string[], slip: string[]): { correct: boolean; complaint: string } {
  const pool = [...expected], hit: string[] = [];
  for (const k of slip){ const i = pool.indexOf(k); if (i >= 0) hit.push(must(pool.splice(i,1)[0], 'pool item')); }
  const correct = hit.length===expected.length && slip.length===expected.length;
  let complaint = '';
  if (!correct){
    const missing = pool[0];
    if (missing && missing[0]==='s'){
      const want = missing.slice(1).split(' ');
      const near = slip.find(k => !hit.includes(k) && k[0]==='s' && k.slice(1).split(' ')[0]===want[0]);
      if (near){ const got = near.slice(1).split(' '); const i = want.findIndex((w,j) => w!==got[j]); complaint = `我要${String(want[i])}㗎！`; }
      else complaint = `我個${String(want[0])}呢？`;
    } else if (missing && missing[0]==='d'){
      const dd = must(DISHES.find(x => missing.startsWith('d'+x.id)), 'dish ' + missing);
      const near = slip.find(k => !hit.includes(k) && k.startsWith('d'+dd.id));
      if (near){
        const want = DFLAGS.filter(f => missing.includes(f)), got = DFLAGS.filter(f => near.includes(f));
        const lack = want.find(f => !got.includes(f)), extra = got.find(f => !want.includes(f));
        complaint = lack ? `我講咗${lack}㗎！` : `我冇叫${String(extra)}喎！`;
      } else complaint = `我個${dd.id}呢？`;
    } else if (missing && missing[0]!=='f'){
      const near = slip.find(k => !hit.includes(k) && !isMeal(k));
      complaint = near && near[0]!==missing[0] ? (missing[0]==='凍' ? '我叫凍嘅！' : '我要熱嘅！') : `我個${label(missing).replace(/^[凍熱]/,'')}呢？`;
    } else complaint = missing ? `我個${label(missing)}呢？` : '我冇叫呢樣喎';
  }
  return { correct, complaint };
}
/* ===================== 招牌菜：貼士同多人叫 ===================== */
export function itemRecipeKey(k: string): string {
  if (k[0]==='f') return 'f:' + foodId(k.slice(1));
  if (k[0]==='s') return 's:' + String(k.slice(1).split(' ')[0]);
  if (k[0]==='d'){ const d = DISHES.find(x => k.startsWith('d' + x.id)); return d ? 'd:' + d.id : ''; }
  const d = drinkOf(k); return d ? 'k:' + d.id : '';
}
