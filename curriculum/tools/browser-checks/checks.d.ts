/* Ambient types for the browser checks (see tsconfig.json beside this file).
   lib.js's fresh() collects console and page errors on the Page object itself,
   so every area module can end with `page.errors.length === 0`; teach the
   Playwright types about that property. */
import type {} from 'playwright-core';

declare module 'playwright-core' {
  interface Page {
    /** console/page errors collected by lib.js's fresh() */
    errors: string[];
  }
}
