// The shop's functions that other code replaces at run time (src/ui/hooks.ts explains why: co-op taps, taste.ts and
// the tests swap them). The rules call each other through this table, never directly, so a replacement is seen by every
// caller. The page's table (ui/hooks.ts HOOK) is this same object with the page's own entries added.
import { enqueue, takeDone, leave, careerArrive } from './referee/customers';
import { seat, submitOrder, cleanTable, serve, toPay } from './referee/judge';
import { update } from './referee/index';
import { aiTill } from './bots/till';
import { tapTable, tapGroup, closeSheet, deselect, sheetAct } from './stations/waiter';
import { tillKey, strikeLine, submitTotal, submitChange, finishCust, closeBoard } from './stations/till';
import { pickLine, barKey } from './stations/bar';
import { pickPlate, assignMeal, kitKey } from './stations/kitchen';
import { good, breakCombo } from './referee/score';

export const CORE_HOOK = {
  // station taps (the screens call these through HOOK)
  tapTable, tapGroup, deselect, sheetAct, closeSheet, barKey, pickLine, kitKey, pickPlate, assignMeal, tillKey, strikeLine,
  // wrapped by taste.ts or the tests
  careerArrive, enqueue, seat, submitOrder, cleanTable, serve, toPay, takeDone, leave, update, good, breakCombo,
  submitTotal, submitChange, finishCust, aiTill, closeBoard,
};
