/* Just enough of the Workers runtime to type-check worker.js with `tsc`, so the
   sync service needs no npm dependency of its own. Nothing here runs. */

/** Bindings, vars and secrets the Worker expects. See wrangler.toml. */
interface Env {
  /** D1 binding: the `progress` table from schema.sql. */
  DB: D1Database;
  /** var: the GitHub OAuth app's client id. */
  GITHUB_CLIENT_ID: string;
  /** var: comma-separated origins allowed to sign in and call the API. */
  ALLOWED_ORIGINS: string;
  /** var, optional: comma-separated GitHub logins allowed to sign in. Unset = anyone. */
  ALLOWED_LOGINS?: string;
  /** secret: the GitHub OAuth app's client secret. */
  GITHUB_CLIENT_SECRET: string;
  /** secret: HMAC key for the session cookie and the OAuth state. */
  SESSION_SECRET: string;
}

interface D1Result {
  success: boolean;
  meta: { changes: number; last_row_id?: number; rows_read?: number; rows_written?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<D1Result>;
  all(): Promise<D1Result & { results: Record<string, unknown>[] }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface ExportedHandler {
  fetch(request: Request, env: Env, ctx?: unknown): Promise<Response>;
}
