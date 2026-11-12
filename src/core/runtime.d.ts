// The few runtime globals src/core/ uses beyond ES2022. Every place core runs has them: the page (DOM), Node (the
// simulations) and workerd (the room's Durable Object). tsconfig.core.json checks core without the DOM
// library; this declaration merges with the DOM's own where that library is loaded.
declare function structuredClone<T>(value: T): T;
