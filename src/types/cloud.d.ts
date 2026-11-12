// Types owned by src/cloud.ts: the backend client (Worker /api/*) and Google Identity Services.
// Worker replies are untrusted at runtime; api() hands them on typed as the JS assumed them (see trustReply in cloud.ts).

/** GET /api/config. `googleClientId` set: offer Google sign-in; `devAuth`: the 測試登入 button; `stats`: usage counters. */
interface CloudCfg { googleClientId?: string; devAuth?: boolean; stats?: boolean; /** The preview's 試玩 panel. */ playtest?: boolean }
interface CloudConn { on: boolean; cfg: CloudCfg | null; token: string }
/** The signed-in player as the game keeps it. */
interface CloudUser { uid: string; displayName: string; provider: string }
/** A user row as the Worker sends it (/api/me, /api/auth/*). The login reply's user may be null (Worker `first()`). */
interface ApiUser { uid: string; name: string; provider: string }
/** What api() is called with (a subset of fetch's RequestInit). */
interface ApiOpt { method?: string; body?: string; headers?: Record<string, string> }
/** One row of GET /api/daily/<day>. */
interface LbRow { name: string; revenue: number; stars: number; station: string; slot: string; me: boolean }
/**
 * A successful Worker reply, as the JS read it: one shape for every endpoint, each caller reads only the fields its
 * endpoint sends (/api/config: CloudCfg; /api/me: user; /api/auth/*: token + user; GET /api/save: shop; GET
 * /api/daily: rows). Not checked at runtime (cloud.ts trustReply).
 */
interface ApiReply extends CloudCfg {
  user: ApiUser | null; token: string; shop: unknown; rows: LbRow[];
  /** GET / PUT /api/save: the save's version (for the two-device merge). Missing from an old Worker and for an account with no save yet. */
  ver?: unknown;
}
/** A save as plain JSON (a copy of SHOP, or a cloud save), the form the per-field merge works on. */
type SaveObj = Record<string, unknown>;
/** The last save this device knows the cloud held, for the three-way merge (cloud.ts cloudBase). */
interface CloudBase { uid: string; shop: SaveObj }

/** Google Identity Services (https://accounts.google.com/gsi/client), as much of it as the game uses. */
interface GsiId {
  initialize(o: { client_id: string | undefined; callback: (r: { credential: string }) => void; ux_mode: string; auto_select: boolean }): void;
  renderButton(el: HTMLElement | null, o: { theme: string; size: string; text: string; shape: string; locale: string }): void;
  disableAutoSelect(): void;
}
interface GoogleGsi { accounts?: { id: GsiId } }
/** Set by the GIS script once it has loaded (window.google); missing before that. */
declare var google: GoogleGsi | undefined;
