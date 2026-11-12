// How each drink and meal is made.
import { ING, ING_X, DRINKS, RECIPE, isSw, CFG, SET_TOP, LUNCH_R, HAT_TXT, DISHES, FRIED_RICE } from '../data/menus';
import { OPEN } from './order';
import { must } from '../util';
import { drinkOf, foodId } from './price';
import { curLevel } from '../state';

export const ingShown = (): string[] => ING.filter(i => !ING_X.includes(i) || OPEN(DRINKS, 'k').some(d => must(RECIPE[d.id], 'recipe ' + d.id)[i]));
export function recipeOf(k: string): DrinkRecipe {
  const cold = k[0]==='凍', r: DrinkRecipe = { cup: cold ? 'cold' : 'hot' };
  ING.forEach(i => { r[i] = 0; }); Object.assign(r, RECIPE[must(drinkOf(k), 'drink ' + k).id]);
  if (cold){ r.冰 = k.includes('走冰') ? 0 : 1; r.糖水 = isSw(must(drinkOf(k), 'drink ' + k).id) || k.includes('走甜') ? 0 : k.includes('少甜') ? 1 : 2; }
  return r;
}
export const cupMatches = (b: GameState['bench'], k: string): boolean => { const r = recipeOf(k); return b.cup===r.cup && ING.every(i => ((b.ing[i] ?? 0)|0)===r[i]); };
// 茶壺：煲 → 焗 → 撞茶幾下 → 有茶（布袋奶茶檔要撞多啲）
export const pullsNeed = (): number => curLevel()?.pulls || CFG.pulls;
/**
 * The tokens a meal key needs on the plate. A set key always has four space-separated parts (setKey) and every set id
 * has a topping in SET_TOP, so the must() calls on them never fire for a key the game made.
 */
export function kitRecipe(k: string): string[] {
  if (k[0]==='s'){
    const [id, noodle, egg, bread0] = k.slice(1).split(' '), bread = must(bread0, 'bread in ' + k);
    const crisp = bread.includes('烘底') ? '烘底' : '';
    const t = [must(noodle, 'noodle in ' + k), must(egg, 'egg in ' + k), must(SET_TOP[must(id, 'set id')], 'topping of ' + k), (bread.includes('餐包') ? '餐包' : '多士') + crisp, bread.startsWith('奶油') ? '奶油' : '牛油'];
    if (bread.includes('飛邊')) t.push('飛邊');
    return t;
  }
  if (k[0]==='f') return [...must(LUNCH_R[foodId(k.slice(1))], 'kitchen recipe ' + k), ...(k.includes(HAT_TXT) ? ['煎蛋'] : [])];
  const d = must(DISHES.find(x => k.startsWith('d'+x.id)), 'dish ' + k).id, n = k.includes('加底') ? 2 : 1, t: string[] = [];
  const rice = (): void => { for (let i = 0; i < n; i++) t.push('飯'); };
  if (FRIED_RICE.includes(d)) t.push(`${d}·飯×${n}`);
  else if (d==='咖喱牛腩飯'){ t.push('咖喱牛腩'); rice(); }
  else if (d==='焗豬扒飯'){ t.push('焗豬扒飯'); if (n > 1) t.push('飯'); }
  else if (k.includes('炒底')) t.push(`${d}·飯×${n}`);
  else { t.push(d); rice(); }
  if (d!=='焗豬扒飯' && !k.includes('走青')) t.push('蔥');
  return t;
}
export const sameBag = (a: string[], b: string[]): boolean => a.length===b.length && [...a].sort().join('|')===[...b].sort().join('|');
