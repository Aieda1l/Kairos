import { parseUtcMinute } from './maintenance-cron-monitor.mjs';

export const watchdogStateSchema = `CREATE TABLE IF NOT EXISTS cron_watchdog_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  observed_at_ms INTEGER NOT NULL,
  incident_id TEXT,
  mail_state TEXT,
  CHECK ((incident_id IS NULL AND mail_state IS NULL) OR
    (incident_id IS NOT NULL AND mail_state IS NOT NULL AND mail_state IN ('claimed','accepted','unconfirmed')))
)`;

const stateUnavailable = () => ({ code: 'CRON_WATCHDOG_STATE_UNAVAILABLE', dispatch: 'none' });

function validCounts(observation) {
  const { code, dueTicks, failedTicks, missingTicks, fromUtc, throughUtc } = observation;
  if (![dueTicks, failedTicks, missingTicks].every(value => Number.isSafeInteger(value) && value >= 0)
    || dueTicks === 0 || failedTicks + missingTicks > dueTicks
    || !Number.isFinite(parseUtcMinute(fromUtc)) || !Number.isFinite(parseUtcMinute(throughUtc))
    || parseUtcMinute(fromUtc) > parseUtcMinute(throughUtc)) return false;
  if (code === 'CRON_OK') return failedTicks === 0 && missingTicks === 0;
  if (code === 'CRON_FAILED') return failedTicks > 0;
  return failedTicks === 0 && missingTicks > 0;
}

export async function runMaintenanceCronWatchdog({ db, observedAtMs, observation, sendAlert }) {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0) return stateUnavailable();
  const { code } = observation;
  if (['CRON_METRICS_UNAVAILABLE', 'CRON_MONITOR_CONFIG_INVALID', 'CRON_NOT_DUE', 'CRON_WINDOW_EXPIRED'].includes(code)) {
    return { code, dispatch: 'none' };
  }
  if (!['CRON_OK', 'CRON_FAILED', 'CRON_OVERDUE'].includes(code) || !validCounts(observation)) {
    return { code: 'CRON_METRICS_UNAVAILABLE', dispatch: 'none' };
  }

  if (code === 'CRON_OK') {
    try {
      const result = await db.prepare(`INSERT INTO cron_watchdog_state VALUES (1, ?, NULL, NULL)
        ON CONFLICT(id) DO UPDATE SET observed_at_ms=excluded.observed_at_ms, incident_id=NULL, mail_state=NULL
        WHERE excluded.observed_at_ms>cron_watchdog_state.observed_at_ms`).bind(observedAtMs).run();
      return result.success ? { code, dispatch: 'none' } : stateUnavailable();
    } catch { return stateUnavailable(); }
  }

  const incidentId = crypto.randomUUID();
  try {
    // Update the time even when an incident is already open. An older healthy
    // observation must not clear it while a newer unhealthy check is in flight.
    const row = await db.prepare(`INSERT INTO cron_watchdog_state VALUES (1, ?, ?, 'claimed')
      ON CONFLICT(id) DO UPDATE SET observed_at_ms=excluded.observed_at_ms,
        incident_id=COALESCE(cron_watchdog_state.incident_id,excluded.incident_id),
        mail_state=COALESCE(cron_watchdog_state.mail_state,excluded.mail_state)
      WHERE excluded.observed_at_ms>cron_watchdog_state.observed_at_ms RETURNING incident_id`)
      .bind(observedAtMs, incidentId).first();
    if (row?.incident_id !== incidentId) return { code, dispatch: 'suppressed' };
  } catch { return stateUnavailable(); }

  let dispatch = 'accepted';
  try {
    const { failedTicks, missingTicks, fromUtc, throughUtc } = observation;
    await sendAlert({ failedTicks, missingTicks, fromUtc, throughUtc });
  } catch {
    dispatch = 'unconfirmed';
  }
  try {
    const result = await db.prepare(`UPDATE cron_watchdog_state SET mail_state=?
      WHERE incident_id=? AND mail_state='claimed'`).bind(dispatch, incidentId).run();
    if (!result.success) return { code, dispatch: 'unconfirmed' };
  } catch { return { code, dispatch: 'unconfirmed' }; }
  return { code, dispatch };
}
