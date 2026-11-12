// Types owned by src/menu.ts.
type RecipeTab = 'breakfast' | 'lunch' | 'dinner' | 'drinks';
/** One menu's recipes: [menu key, fee] (fee 0 = known from the start). */
interface RecipeGroup { name: string; items: [string, number][] }
/** The four menus by name. */
type RecipeBook = Record<RecipeTab, RecipeGroup>;
/** A secret recipe: learnt after SPECIAL_STARS on level `lv`, for `p`; `kit` overrides the level's kitchen. */
interface SpecialRecipe { lv: string; p: number; kit?: LevelKit }
