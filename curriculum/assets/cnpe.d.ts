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

/** One flashcard in the generated question bank (CNPE_DRILL). */
interface CnpeDrillQuestion {
  /** "sec#slug-of-the-question" */
  id: string;
  /** owning section id, e.g. "2.3" */
  sec: string;
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

/** The seam between app.js and drill.js (CNPE_PROGRESS). */
interface CnpeProgressApi {
  get(): CnpeStore;
  save(): void;
  /** count one action toward today's study heartbeat */
  bump(kind: "c" | "x" | "s" | "e"): void;
  streak(): { streak: number; best: number };
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
  CNPE_PROGRESS?: CnpeProgressApi;
  CNPE_THEME?: CnpeThemeApi;
  CNPE_WIDGETS?: { mount(): void };
  CNPE_DRILL_UI?: { mount(): void };
  /** re-run by the single-file bundle on every hash navigation */
  CNPE_BOOT?: () => void;
  /** set only by the bundled console (tools/bundle.py) */
  CNPE_BUNDLE?: boolean;
  /** clipboard stub installed by the browser checks */
  __copied?: string[];
}
