import "server-only";
import type Database from "better-sqlite3";
export class SourceCredentialRepository {
  constructor(private readonly db: Database.Database) {}
  setCanvasFeedUrl(connectionId: string, feedUrl: string): void {
    this.db.prepare(`INSERT INTO source_credentials(source_connection_id,canvas_feed_url,updated_at) VALUES (?,?,?)
      ON CONFLICT(source_connection_id) DO UPDATE SET canvas_feed_url=excluded.canvas_feed_url, updated_at=excluded.updated_at`).run(connectionId, feedUrl, new Date().toISOString());
  }
  setEdApiToken(connectionId: string, token: string): void {
    this.db.prepare(`INSERT INTO source_credentials(source_connection_id,ed_api_token,updated_at) VALUES (?,?,?)
      ON CONFLICT(source_connection_id) DO UPDATE SET ed_api_token=excluded.ed_api_token, updated_at=excluded.updated_at`).run(connectionId, token, new Date().toISOString());
  }
  getEdApiToken(connectionId: string): string | null {
    const row = this.db.prepare("SELECT ed_api_token FROM source_credentials WHERE source_connection_id=?").get(connectionId) as { ed_api_token: string | null } | undefined;
    return row?.ed_api_token ?? null;
  }
  getCanvasFeedUrl(connectionId: string): string | null {
    const row = this.db.prepare("SELECT canvas_feed_url FROM source_credentials WHERE source_connection_id=?").get(connectionId) as { canvas_feed_url: string | null } | undefined;
    return row?.canvas_feed_url ?? null;
  }
}
