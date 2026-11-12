// The 燒味 station as the referee will register it: the core with its computer driver. `roast` makes its own customers
// (the standalone page and the tests); `roastFed` waits for the referee's `order` events.
import { roastStation } from './core';
import { roastBot } from './bot';

export const roast = roastStation({ selfFeed: true }, roastBot);
export const roastFed = roastStation({ selfFeed: false }, roastBot);
export * from './core';
export { plan, resetBot, handOver, setBotAim, BOT } from './bot';
