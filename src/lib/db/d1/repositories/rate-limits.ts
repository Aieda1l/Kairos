import "server-only";
import {validBudget} from "@/lib/abuse/policy";
import {AbuseConfigurationError,AbuseStorageUnavailableError,boundedRetryAfter,type RateDecision} from "@/lib/abuse/types";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

// SQLite's 'now' is constant during a statement. Time is evaluated at execution,
// never read in JS and bound into a later admission statement.
const DB_NOW_MS="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
// All tunable windows are <= 1 hour. Keep events for that entire horizon so
// deployments that tune a window do not silently erase live admission history.
const RETENTION_MS=3_600_000;
export class D1RateLimitRepository{
  constructor(private readonly db:D1DatabaseLike){}

  async consume(input:{keyHash:string;userId:string|null;limit:number;windowSeconds:number}):Promise<RateDecision>{
    if(!validBudget(input)||!/^[A-Za-z0-9_-]{43}$/.test(input.keyHash)
      ||(input.userId!==null&&(typeof input.userId!=="string"||!input.userId.trim()||input.userId.length>256))){
      throw new AbuseConfigurationError();
    }
    try{
      const admitted=await this.db.prepare(`
        WITH clock(now_ms) AS (SELECT ${DB_NOW_MS})
        INSERT INTO abuse_rate_events(event_id,key_hash,user_id,admitted_at_ms,purge_after_ms)
        SELECT ?,?,?,now_ms,now_ms+${RETENTION_MS} FROM clock
        WHERE (SELECT COUNT(*) FROM abuse_rate_events
          WHERE key_hash=? AND admitted_at_ms>now_ms-? AND admitted_at_ms<=now_ms) < ?
      `).bind(crypto.randomUUID(),input.keyHash,input.userId,input.keyHash,input.windowSeconds*1000,input.limit).run();
      if(admitted.success!==true||(admitted.meta.changes!==0&&admitted.meta.changes!==1))throw new AbuseStorageUnavailableError();
      if(admitted.meta.changes===1)return {allowed:true};
      const row=await this.db.prepare(`
        WITH clock(now_ms) AS (SELECT ${DB_NOW_MS})
        SELECT (SELECT admitted_at_ms FROM abuse_rate_events
          WHERE key_hash=? AND admitted_at_ms>now_ms-? AND admitted_at_ms<=now_ms
          ORDER BY admitted_at_ms LIMIT 1) AS oldest_ms, now_ms FROM clock
      `).bind(input.keyHash,input.windowSeconds*1000).first<{oldest_ms:number|null;now_ms:number}>();
      if(!row||!Number.isSafeInteger(row.now_ms)
        ||(row.oldest_ms!==null&&!Number.isSafeInteger(row.oldest_ms)))throw new AbuseStorageUnavailableError();
      // A row may expire between denial and this read. It remains a denial;
      // offer a one-second retry without inserting or extending the window.
      return {allowed:false,retryAfterSeconds:boundedRetryAfter(row.oldest_ms===null?1:(row.oldest_ms+input.windowSeconds*1000-row.now_ms)/1000)};
    }catch{throw new AbuseStorageUnavailableError();}
  }
}
