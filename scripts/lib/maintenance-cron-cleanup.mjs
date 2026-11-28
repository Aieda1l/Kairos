import { maintainAbuseState } from './abuse-maintenance.mjs';

export const cleanupCron = '17 * * * *';

export const cleanupControlSchema = `
  CREATE TABLE IF NOT EXISTS cron_cleanup_control (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    apply_enabled INTEGER NOT NULL DEFAULT 0 CHECK (apply_enabled IN (0, 1)),
    apply_from_ms INTEGER NOT NULL DEFAULT 0 CHECK (apply_from_ms >= 0),
    last_tick_ms INTEGER NOT NULL DEFAULT 0 CHECK (last_tick_ms >= 0),
    state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'running', 'success', 'failure')),
    counts_json TEXT
  ) STRICT;
  INSERT INTO cron_cleanup_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

const minuteMs = 60_000;
const batchSize = 100;
const failed = () => new Error('CRON_CLEANUP_FAILED');

function changedOne(result) {
  if (!result?.success || ![0, 1].includes(result.meta?.changes)) throw failed();
  return result.meta.changes === 1;
}

export async function runMaintenanceCronCleanup({ controller, env, nowMs = Date.now() }) {
  const mode = env.KAIROS_CRON_CLEANUP_MODE;
  if (mode !== 'dry-run' && mode !== 'apply') return { status: 'off' };

  const scheduledMs = controller?.scheduledTime;
  if (controller?.cron !== cleanupCron || !Number.isSafeInteger(scheduledMs) || scheduledMs <= 0
    || !Number.isSafeInteger(nowMs) || nowMs <= 0 || scheduledMs - nowMs > 15_000) {
    return { status: 'invalid-trigger' };
  }
  const scheduledMinute = Math.floor(scheduledMs / minuteMs);
  const tickMs = scheduledMinute * minuteMs;
  if (scheduledMinute % 60 !== 17 || nowMs - tickMs > 5 * minuteMs) {
    return { status: 'invalid-trigger' };
  }

  try {
    if (mode === 'dry-run') {
      const counts = await maintainAbuseState(env.DB, { batchSize, apply: false });
      return { status: 'dry-run', tickMs, counts };
    }

    const operations = env.OPERATIONS;
    const claimed = await operations.prepare(`
      UPDATE cron_cleanup_control
      SET last_tick_ms = ?, state = 'running', counts_json = NULL
      WHERE id = 1 AND apply_enabled = 1 AND apply_from_ms > 0 AND apply_from_ms % (60 * 60000) = (17 * 60000)
        AND apply_from_ms <= ?
        AND last_tick_ms < ? AND state IN ('idle', 'success', 'failure')
    `).bind(tickMs, tickMs, tickMs).run();
    if (!changedOne(claimed)) return { status: 'not-admitted' };

    // A rejected D1 request may have executed. Retain the running receipt
    // when settlement is uncertain so a later tick cannot admit another sweep.
    const counts = await maintainAbuseState(env.DB, { batchSize, apply: true });
    const settled = await operations.prepare(`
      UPDATE cron_cleanup_control
      SET state = 'success', counts_json = ?
      WHERE id = 1 AND last_tick_ms = ? AND state = 'running'
    `).bind(JSON.stringify(counts), tickMs).run();
    if (!changedOne(settled)) throw failed();
    return { status: 'applied', tickMs, counts };
  } catch {
    throw failed();
  }
}
