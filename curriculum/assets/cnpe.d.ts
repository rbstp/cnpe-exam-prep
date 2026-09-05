/* Ambient types for the study console. Nothing here exists at runtime. */

/** One section (or exam/drill page) in the nav manifest. */
interface CnpeNavEntry {
  /** "1.1" through "5.6", or "EX" / "EX2" / "DR" / "GM" for the domainless pages */
  id: string;
  /** owning domain 1-5; 0 for the exams, the drill and the quest */
  d: number;
  /** page path relative to curriculum/ */
  path: string;
  title: string;
  /** the make targets the section's lab work needs */
  needs: string;
  /** suggested session length, minutes */
  mins: number;
  /** space-separated search terms for the palette */
  tags: string;
}

/** One exam domain in CNPE_DOMAINS. */
interface CnpeDomain {
  n: number;
  key: string;
  name: string;
  weight: string;
  layers: string;
}

/** A card's identity, which is all the dashboard's counting needs (CNPE_DRILL_INDEX). */
interface CnpeDrillCard {
  /** "sec#slug-of-the-question" */
  id: string;
  /** owning section id, e.g. "2.3" */
  sec: string;
}

/** One flashcard in the generated question bank (CNPE_DRILL). */
interface CnpeDrillQuestion extends CnpeDrillCard {
  /** question, HTML */
  q: string;
  /** answer, HTML */
  a: string;
}

/** One day's counter: browser id to that browser's own count, read as the sum,
    so two browsers on one day add up. A plain number is a store written before
    the counters were per browser, and reads as one unnamed slot. */
type CnpeDayCount = Record<string, number> | number;

/** Per-day action counters under store.days["YYYY-MM-DD"]:
    cards answered, exercises verified, sections completed, exam tasks scored. */
interface CnpeDayCounts {
  c?: CnpeDayCount;
  x?: CnpeDayCount;
  s?: CnpeDayCount;
  e?: CnpeDayCount;
}

/** Per-question drill record under store.drill[question id]. */
interface CnpeDrillRecord {
  /** times answered right */
  r: number;
  /** times missed */
  m: number;
  /** outcome of the most recent answer */
  ok?: boolean;
  /** epoch ms of the most recent answer */
  t?: number;
}

/** The drill's own day counter and daily-goal marker (store.drillmeta). */
interface CnpeDrillMeta {
  /** legacy: today's card count is days[today].c, and neither is written now */
  day?: string;
  n?: number;
  earned?: string;
  streak?: number;
  best?: number;
  t?: number;
}

/** One mock exam's clock and scored tasks (store.exam / store.exam2). */
interface CnpeExamState {
  /** task index → 1 scored / 0 not */
  tasks?: Record<string, number>;
  /** epoch ms the running stretch started */
  startedAt?: number;
  /** seconds spent across previous stretches */
  spent?: number;
  running?: boolean;
}

/** One battle's record under store.game.wins[scenario id]. */
interface CnpeGameWin {
  /** times won */
  n: number;
  /** fewest turns a win took */
  best?: number;
  /** epoch ms of the latest win */
  t?: number;
}

/** The quest's own progress (store.game). Counters are per-browser slot maps
    read as the sum, like the day counters, so two browsers add up; ticks are
    unions, because nothing in the game un-clears; the position carries its
    stamp so the latest one wins. Readers tolerate junk in any slot. */
interface CnpeGameState {
  /** experience earned, per browser */
  xp?: CnpeDayCount;
  /** gold earned (e) and spent (s), per browser; held is the difference */
  gold?: { e?: CnpeDayCount; s?: CnpeDayCount };
  /** item id -> got (g) and used (u), per browser; held is the difference */
  items?: Record<string, { g?: CnpeDayCount; u?: CnpeDayCount }>;
  /** section id -> 1 once its trial is cleared */
  towns?: Record<string, number>;
  /** technique id -> 1 once an NPC taught it */
  learned?: Record<string, number>;
  /** scenario id -> the record of beating it */
  wins?: Record<string, CnpeGameWin>;
  /** intro seen, bosses beaten, the final: flag -> 1 */
  flags?: Record<string, number>;
  /** where the player stood, in tiles, and when */
  pos?: { x: number; y: number; t: number };
}

/** The whole cnpe:v2 localStorage store. Readers tolerate junk in any slot. */
interface CnpeStore {
  /** exercise key ("id#slug") → 1 verified / 0 not */
  ex: Record<string, number>;
  /** section id → 1 complete / 0 not */
  done: Record<string, number>;
  exam: CnpeExamState;
  exam2?: CnpeExamState;
  drill: Record<string, CnpeDrillRecord>;
  drillmeta: CnpeDrillMeta;
  days: Record<string, CnpeDayCounts>;
  /** the quest's progress; absent in a store from before the game */
  game?: CnpeGameState;
  /** section id last read, for the resume button */
  last: string | null;
  /** epoch ms that pointer was set, so the newest read wins across browsers */
  lastAt?: number;
  /** the study run that ran on below the days the store still carries: how long
      it was (n) and the day it ended on (d), which is the day before the oldest
      kept. Written by pruneDays, read by streak. */
  run?: { d: string; n: number };
}

/** How much a merge added, per bucket, plus how much it took away. */
interface CnpeMergeCounts {
  done: number;
  ex: number;
  exam: number;
  drill: number;
  days: number;
  /** game fields that grew: counters, ticks, win records, the position */
  game: number;
  /** 1 when the merge moved the resume pointer */
  last: number;
  /** ticks the merge cleared; always 0 without a base */
  off: number;
}

/** The ticked keys of a store, per bucket: what `cnpe:sync-base` holds. */
interface CnpeTickSets {
  done: string[];
  ex: string[];
  /** exam.tasks, not exam */
  exam: string[];
  exam2: string[];
}

/** What `cnpe:sync-base` holds: those ticks, plus the row they came from. */
interface CnpeSyncBase extends CnpeTickSets {
  /** the GitHub account id the row belongs to */
  uid?: string;
  /** the revision that held exactly these ticks */
  rev?: number;
}

/** The same four buckets as lookup maps, which is the shape the merge reads. */
type CnpeMergeBase = Record<"done" | "ex" | "exam" | "exam2", Record<string, 1>>;

/** The DOM-free merge, shared by app.js, sync.js and tools/merge-test.mjs. */
interface CnpeMergeApi {
  /** merge src into store: counters take the max, and ticks resolve against
      base as (local === base) ? remote : local, so no base means a plain union */
  merge(store: unknown, src: unknown, base?: CnpeMergeBase): CnpeMergeCounts;
  /** the ticked keys of a store, per bucket */
  ticks(p: unknown): CnpeTickSets;
  /** those four lists as the lookup maps the merge reads */
  sets(b: unknown): CnpeMergeBase;
  /** the same, narrowed to the keys another store mentions: what one tab may
      hold as a base against another tab's copy */
  shared(seen: CnpeTickSets, p: unknown): CnpeMergeBase;
  /** key-order-independent serialisation, for comparing two stores */
  canon(v: unknown): string;
  /** the base a browser may hold against the copy that arrived, or null when the
      row it came from is not the row that arrived; the caller owns the rest */
  pickBase(b: unknown, progress: unknown, rev: number, uid: string): CnpeMergeBase | null;
  /** a store as it goes over the wire: no exam clock */
  wire(p: unknown): unknown;
  /** whether a store holds anything worth a remote row */
  hasAnything(p: unknown): boolean;
  /** milliseconds until a drill card comes round again; zero or less is due now,
      worked out from the card's own r/m/ok/t on an SM-2 shaped ladder */
  dueIn(rec: unknown, now: number): number;
  /** backfill days for a streak earned before the console counted them */
  seedDays(s: unknown): void;
  /** one day counter as a number, summing the browsers that contributed to it */
  countOf(v: unknown): number;
  /** drop days older than the window, folding the record they hold into
      drillmeta.best first; returns how many were dropped */
  pruneDays(s: unknown, today?: string): number;
  /** days of history a store carries */
  KEEP: number;
  /** merge src.game into store.game by the quest's rules; how many fields grew */
  mergeGame(store: unknown, src: unknown): number;
  /** whether a game bucket holds anything a player earned */
  gameHasAnything(g: unknown): boolean;
  /** consecutive days with a heartbeat, counted back from today ("YYYY-MM-DD",
      defaulting to the clock), plus a best that drillmeta.best can only raise */
  streak(store: unknown, today?: string): { streak: number; best: number };
  dayKey(d: Date): string;
  /** k plus or minus n days, in local time */
  shiftKey(k: string, by: number): string;
  /** how many study actions one day record holds */
  dayActs(rec: unknown): number;
  DAY_RE: RegExp;
}

/** The seam between app.js and drill.js / sync.js (CNPE_PROGRESS). */
interface CnpeProgressApi {
  get(): CnpeStore;
  save(): void;
  /** count one action toward today's study heartbeat */
  bump(kind: "c" | "x" | "s" | "e"): void;
  streak(): { streak: number; best: number };
  /** the store as it is on the disk, which is not always the one in memory */
  saved(): unknown;
  /** merge in another store: counters take the max, and ticks resolve against
      base as (local === base) ? remote : local, so no base means a plain union */
  merge(src: unknown, base?: CnpeMergeBase): CnpeMergeCounts;
  /** called after every save, so the optional sync can mirror it */
  onSave(fn: () => void): void;
  /** this browser's slot in the per-browser counters (the cnpe:dev id) */
  slot(): string;
}

/** The command-block colouring (CNPE_SYNTAX). Escaped HTML in, escaped out. */
interface CnpeSyntaxApi {
  /** shield strings and comments, then run the language's passes */
  highlight(html: string, lang: string): string;
  /** one language's passes, over a run holding no string */
  paint(s: string, lang: string): string;
}

/** Optional remote progress sync (CNPE_SYNC). Absent over file://. */
interface CnpeSyncApi {
  mount(): void;
  signedIn(): boolean;
  /** delete the copy held for this account; local progress is untouched */
  forget(): Promise<void>;
  /** drop the merge base, so the next pull is a plain union */
  forgetBase(): void;
  state(): { on: boolean; login: string; rev: number; note: string };
}

/** theme.js's three-state switch (CNPE_THEME). */
interface CnpeThemeApi {
  modes: string[];
  pref(): string;
  resolved(): string;
  set(next: string): void;
  cycle(): void;
  onChange(fn: (pref: string, resolved: string) => void): void;
}

/** One tile row of the overworld is a string; the chars index CNPE_GAME_DATA.tiles. */
interface CnpeGameRegion {
  /** domain number 1-5 */
  d: number;
  name: string;
  /** the boss scenario ids this region's keep chains */
  boss: string[];
  /** where the keep's door sits */
  keep: { x: number; y: number };
}

interface CnpeGameNpc {
  name: string;
  /** what they say, one entry per line box */
  lines: string[];
  /** the technique this NPC teaches, if any */
  teaches?: string;
}

interface CnpeGameTown {
  /** section id, e.g. "2.3"; the trial is that section's self-check cards */
  sec: string;
  name: string;
  /** one line about the place, shown on entering */
  blurb?: string;
  x: number;
  y: number;
  npcs: CnpeGameNpc[];
  /** the scenario behind this town's dungeon door */
  dungeon: string;
  /** where the door sits */
  door: { x: number; y: number };
}

interface CnpeGameTechnique {
  /** the command template; {ns} {res} {pod} {kind} {sa} {app} {name} are
      filled from the scenario, capitals and trailing = are left to the player */
  cmd: string;
  /** a repair rather than an inspection: it sits in the Fix menu */
  fix?: boolean;
  /** what it is for, one line */
  about: string;
  /** the tool family, which the cheat sheets key on */
  tool: string;
}

interface CnpeGameItem {
  name: string;
  about: string;
  /** shop price in gold; 0 means not for sale */
  price: number;
  /** a permanent item is never used up */
  permanent?: boolean;
}

/** One piece of evidence a battle wants found. */
interface CnpeGameEvidence {
  id: string;
  /** regexes over the normalised command, any of which surfaces it */
  match: string[];
  /** what the cluster answers; absent, the generic handler's rendering of the
      resource table is the answer, and the table carries the tell */
  out?: string;
  /** the tell-tale line, highlighted in the terminal when it shows */
  tell?: string;
  /** what the Hint Scroll says about it */
  hint: string;
}

/** One event in a scenario's cluster: what `get events` lists and `describe` appends. */
interface CnpeGameEvent {
  type: string;
  reason: string;
  age: string;
  from: string;
  /** "Pod/broken-x", matched case-insensitively by describe */
  obj: string;
  msg: string;
  /** defaults to the scenario's namespace */
  ns?: string;
}

/** One resource in a scenario's fake cluster, for the generic handlers. */
interface CnpeGameResource {
  /** plural, lower-case, as the normaliser writes it */
  kind: string;
  name: string;
  ns?: string;
  /** the columns `get` prints beyond NAME, in the order the kind lists them */
  cols?: string[];
  /** extra columns for -o wide, and their headings */
  wide?: string[];
  wideCols?: string[];
  /** labels and annotations, "k=v,k=v" */
  labels?: string;
  annotations?: string;
  /** apiVersion and Kind for -o yaml, when the defaults are wrong */
  api?: string;
  kindName?: string;
  /** what -o yaml prints after metadata, indented as written */
  yaml?: string;
  /** what describe prints between the header and the events */
  desc?: string;
  /** jsonpath -> value, for -o jsonpath */
  fields?: Record<string, string>;
  /** the workload a pod belongs to, for `logs deploy/x` */
  owner?: string;
  container?: string;
  /** container logs, the previous container's logs, or the error logs gives */
  logs?: string;
  prevLogs?: string;
  logsErr?: string;
  /** exec fails, the container not being up */
  notRunning?: boolean;
  /** regex over the exec'd command -> its output */
  exec?: Record<string, string>;
  /** kubectl top's two columns */
  top?: string[];
  /** what `kubectl rollout status` prints for this workload */
  rollout?: string;
  /** for a Rollout, the argo rollouts plugin's view: phase, step, weight, and `get`'s tree */
  canary?: { status?: string; step?: string; weight?: string; get?: string };
  /** flux get's REVISION, SUSPENDED, READY, MESSAGE */
  flux?: string[];
  /** flux tree's body, flux reconcile's tail */
  tree?: string;
  reconcile?: string;
  /** argocd app get/list's fields */
  argo?: { dest?: string; repo?: string; path?: string; rev?: string; sync?: string; health?: string;
    conditions?: string; condLines?: string; resources?: string; syncOut?: string; diff?: string };
  /** crossplane beta trace's tree */
  trace?: string;
}

interface CnpeGameScenario {
  id: string;
  /** the monster's name */
  name: string;
  /** owning domain 1-5 */
  d: number;
  /** 1 to 3; scales the enemy's hits and the reward */
  difficulty: number;
  /** the incident ticket */
  ticket: string;
  /** the truth, shown after the battle */
  answer: string;
  /** the namespace the generic handlers default to */
  ns: string;
  resources: CnpeGameResource[];
  events?: CnpeGameEvent[];
  /** subject (--as) -> resource -> verbs it may use, "*" for all */
  canI?: Record<string, Record<string, string>>;
  /** image references cosign verify accepts */
  signed?: string[];
  evidence: CnpeGameEvidence[];
  /** regexes over the normalised command that repair the fault */
  fix: string[];
  /** what the cluster says to a correct fix */
  fixOut: string;
  /** regexes for the plausible wrong repairs, each with what happens */
  wrong: { match: string[]; out: string }[];
}

interface CnpeGameData {
  /** the overworld, one string per row */
  map: string[];
  /** char -> tile name the renderer draws */
  tiles: Record<string, string>;
  regions: CnpeGameRegion[];
  towns: CnpeGameTown[];
  techniques: Record<string, CnpeGameTechnique>;
  items: Record<string, CnpeGameItem>;
  scenarios: CnpeGameScenario[];
  /** the final boss's pool and clock */
  finale: { pool: string[]; pick: number; keep: { x: number; y: number } };
  /** xp needed to reach each level; index 0 is level 1 */
  levels: number[];
  /** where a new game starts */
  start: { x: number; y: number };
}

/** The theme's colours, read live from the stylesheet's custom properties by
    game.js and handed to the art so every sprite is painted in the current theme. */
interface CnpeGamePalette {
  ink: string; sunk: string; s1: string; s2: string; s3: string;
  rule: string; rule2: string; paper: string; paper2: string; paper3: string;
  accent: string; accentDim: string; accentLit: string; warn: string; warnDim: string;
  ok: string; okLit: string; bad: string; badLit: string; viol: string; info: string;
}

/** The quest's art (CNPE_ART, assets/game-art.js): palette-indexed pixel grids
    painted to small canvases on demand and cached per theme. Tile masks name
    the neighbours of a different kind: N=1 E=2 S=4 W=8 for road and cliff,
    and the eight-way N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128 for the shore. */
interface CnpeArtApi {
  /** the tile size in pixels, 16 */
  TILE: number;
  /** how many frames the water has */
  FRAMES: number;
  /** the fault families that have an enemy sprite */
  FAMILIES: string[];
  /** repaint everything from this palette from now on; drops the sprite cache */
  theme(p: CnpeGamePalette): void;
  grass(variant: number, region: number): HTMLCanvasElement;
  flower(variant: number, region: number): HTMLCanvasElement;
  road(variant: number, region: number, mask: number): HTMLCanvasElement;
  sand(variant: number, region: number): HTMLCanvasElement;
  tree(variant: number, region: number): HTMLCanvasElement;
  cliff(variant: number, region: number, mask: number): HTMLCanvasElement;
  water(mask: number, frame: number): HTMLCanvasElement;
  bridge(vertical: boolean): HTMLCanvasElement;
  town(region: number): HTMLCanvasElement;
  door(region: number, open: boolean): HTMLCanvasElement;
  keep(region: number, cleared: boolean): HTMLCanvasElement;
  /** 0 shut, 1 open, 2 passed */
  gate(state: number): HTMLCanvasElement;
  /** face is u d l r; frame alternates as you walk */
  hero(face: string, frame: number): HTMLCanvasElement;
  /** a 32 by 32 monster at the given pixel scale (default 3, so 96 px) */
  enemy(family: string, scale?: number): HTMLCanvasElement;
  /** the fault family a scenario belongs to: workload, networking, storage,
      gitops, ci, crossplane, observability or security */
  familyOf(scenarioId: string, domain: number): string;
  /** a strip of scenery for a town menu: square, talk, inn or shop */
  backdrop(scene: string, region: number, w: number, h: number): HTMLCanvasElement;
  /** names of grids that are not the size they claim; empty when the art is sound */
  check(): string[];
}

/** What CNPE_GAME.debug() reports, for the browser checks and profiling. */
interface CnpeGameDebug {
  /** frames painted, and the milliseconds they took in all */
  frames: number; drawMs: number;
  /** whole-map terrain renders, their milliseconds, and the cache's size */
  terrainRenders: number; terrainMs: number; terrain: { w: number; h: number } | null;
  /** the canvas backing scale, and the device pixel ratio it was chosen for */
  scale: number; dpr: number;
  /** the water ticker is running */
  anim: boolean;
  /** the visitor asked for reduced motion */
  reduceMotion: boolean;
  waterFrame: number; walkFrame: number; face: string;
  /** paint now, without waiting for the next animation frame */
  frame(): void;
}

/** What one command did to a battle. */
interface CnpeSimResult {
  /** the terminal's answer, plain text */
  out: string;
  /** the evidence this command surfaced, if any */
  evidence?: string;
  /** the command repaired the fault */
  fixed?: boolean;
  /** the command was a plausible wrong repair */
  wrong?: boolean;
  /** the command changed nothing and answered nothing specific */
  generic?: boolean;
}

/** The DOM-free command interpreter (CNPE_SIM), driven by tools/game-sim-test.mjs. */
interface CnpeSimApi {
  /** a command as the matchers see it: aliases expanded, namespace and output
      flags in canonical form, pipes stripped */
  normalize(cmd: string): string;
  /** the scenario's answer to one command; found is the evidence ids already surfaced */
  run(scenario: CnpeGameScenario, found: Record<string, number>, cmd: string): CnpeSimResult;
  /** the command's tool family, which cheat sheets and typed bonuses key on */
  toolOf(cmd: string): string;
  /** a kind alias in its plural canonical form */
  kindOf(k: string): string;
}

interface Window {
  CNPE_GAME_DATA?: CnpeGameData;
  CNPE_SIM?: CnpeSimApi;
  /** the quest; mount() is idempotent per page, like the drill's */
  CNPE_GAME?: { mount(): void; debug?(): CnpeGameDebug };
  CNPE_ART?: CnpeArtApi;
  CNPE_NAV?: CnpeNavEntry[];
  CNPE_DOMAINS?: CnpeDomain[];
  CNPE_DRILL?: CnpeDrillQuestion[];
  /** the same deck without the prose; the dashboard loads this instead */
  CNPE_DRILL_INDEX?: CnpeDrillCard[];
  CNPE_MERGE?: CnpeMergeApi;
  CNPE_SYNTAX?: CnpeSyntaxApi;
  CNPE_PROGRESS?: CnpeProgressApi;
  CNPE_SYNC?: CnpeSyncApi;
  /** origin of the sync Worker; defaults to https://sync.rbstp.dev */
  CNPE_SYNC_API?: string;
  /** ms the sync waits after the last save before pushing; defaults to 30000 */
  CNPE_SYNC_DEBOUNCE?: number;
  CNPE_THEME?: CnpeThemeApi;
  CNPE_WIDGETS?: { mount(): void };
  CNPE_DRILL_UI?: { mount(): void };
  /** re-run by the single-file bundle on every hash navigation */
  CNPE_BOOT?: () => void;
  /** set only by the bundled console (tools/bundle.py) */
  CNPE_BUNDLE?: boolean;
  /** clipboard stub installed by the browser checks */
  __copied?: string[];
  /** store-write counter installed by the browser checks */
  __writes?: number;
}
