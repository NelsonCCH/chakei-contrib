// Types owned by src/share.ts.
/** What the score card shows (cardStats). L is the level, or a falsy value off a level, as the JS left it. */
interface CardStats {
  L: Level | '' | null | undefined; stars: number | null; disaster: boolean | '' | null | undefined;
  title: string; line: string | undefined; burnt: number; angry: number; mistakes: number;
}
