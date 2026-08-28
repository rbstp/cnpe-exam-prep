/* Ambient types for the browser checks. */
import type {} from 'playwright-core';

declare module 'playwright-core' {
  interface Page {
    /** console/page errors collected by lib.js's fresh() */
    errors: string[];
  }
}
