/* Ambient types for the study console. Nothing here exists at runtime. */

/** One section (or exam/drill page) in the nav manifest. */
interface CnpeNavEntry {
  /** "1.1" through "5.6", or "EX" / "EX2" / "DR" for the domainless pages */
  id: string;
  /** owning domain 1-5; 0 for the exams and the drill */
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

/** Per-day action counters under store.days["YYYY-MM-DD"]:
    cards answered, exercises verified, sections completed, exam tasks scored. */
interface CnpeDayCounts {
  c?: number;
  x?: number;
  s?: number;
  e?: number;
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
  /** section id last read, for the resume button */
  last: string | null;
}

/** How much a merge added, per bucket, plus how much it took away. */
interface CnpeMergeCounts {
  done: number;
  ex: number;
  exam: number;
  drill: number;
  days: number;
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
  /** a store as it goes over the wire: no exam clock, no resume pointer */
  wire(p: unknown): unknown;
  /** whether a store holds anything worth a remote row */
  hasAnything(p: unknown): boolean;
  /** milliseconds until a drill card comes round again; zero or less is due now,
      worked out from the card's own r/m/ok/t on an SM-2 shaped ladder */
  dueIn(rec: unknown, now: number): number;
  /** backfill days for a streak earned before the console counted them */
  seedDays(s: unknown): void;
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

interface Window {
  CNPE_NAV?: CnpeNavEntry[];
  CNPE_DOMAINS?: CnpeDomain[];
  CNPE_DRILL?: CnpeDrillQuestion[];
  /** the same deck without the prose; the dashboard loads this instead */
  CNPE_DRILL_INDEX?: CnpeDrillCard[];
  CNPE_MERGE?: CnpeMergeApi;
  CNPE_PROGRESS?: CnpeProgressApi;
  CNPE_SYNC?: CnpeSyncApi;
  /** origin of the sync Worker; defaults to https://sync.rbstp.dev */
  CNPE_SYNC_API?: string;
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
