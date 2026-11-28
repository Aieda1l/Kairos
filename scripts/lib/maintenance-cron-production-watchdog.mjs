const minute = 60_000;
const hour = 60 * minute;
const offset = 17 * minute;
const iso = value => new Date(value).toISOString();
const result = (code, dispatch = 'none') => ({ code, dispatch });
const unavailable = () => result('CRON_WATCHDOG_STATE_UNAVAILABLE');
const validTick = value => Number.isSafeInteger(value) && value > 0 && value % hour === offset;

export const productionWatchdogSchema = `CREATE TABLE IF NOT EXISTS cron_watchdog_production_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL,
  activation_ms INTEGER NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  closed_through_ms INTEGER NOT NULL,
  pending_missing_ms INTEGER,
  incident_id TEXT,
  latest_problem_ms INTEGER,
  mail_state TEXT,
  CHECK ((incident_id IS NULL AND latest_problem_ms IS NULL AND mail_state IS NULL)
    OR (incident_id IS NOT NULL AND latest_problem_ms IS NOT NULL AND mail_state IS NOT NULL
    AND mail_state IN ('claimed','accepted','unconfirmed')))
)`;

function validObservation(activationMs, pollMs, ticks) {
  return validTick(activationMs) && Number.isSafeInteger(pollMs)
    && Array.isArray(ticks) && ticks.length > 0 && ticks.length <= 12
    && ticks.every(({ tickMs, status }, index) => validTick(tickMs) && tickMs >= activationMs
      && tickMs <= pollMs - 10 * minute && (index === 0 || tickMs - ticks[index-1].tickMs === hour)
      && ['success', 'failure', 'missing'].includes(status));
}

function decide(previous, ticks, completion) {
  const receiptTick = completion?.last_tick_ms;
  const completedTick = completion?.state === 'success' && validTick(receiptTick) ? receiptTick : 0;
  const newest = ticks.at(-1);
  const verified = ticks.some(tick => tick.tickMs === completedTick && tick.status === 'success');
  const previousClosure = previous?.closed_through_ms ?? 0;
  const closed = Math.max(previousClosure, verified ? completedTick : 0);
  const failureTicks = ticks.filter(({ tickMs, status }) => tickMs > closed
    && (status === 'failure' || (tickMs === receiptTick && completion.state === 'failure')));
  const missingTicks = ticks.filter(({ tickMs, status }) => tickMs > closed && tickMs !== completedTick
    && tickMs !== (completion?.state === 'failure' ? receiptTick : null)
    && (status === 'missing' || (status === 'success' && tickMs === newest.tickMs
      && Number.isSafeInteger(receiptTick) && receiptTick <= tickMs)));
  const repeated = missingTicks.find(item => item.tickMs === previous?.pending_missing_ms);
  const pending = repeated?.tickMs ?? missingTicks[0]?.tickMs ?? null;
  // A scan after a watchdog gap can discover a failure and its recovery
  // together. Report that once if no existing incident covered the gap.
  const recoveredFailures = !previous?.incident_id && !failureTicks.length && !repeated
    ? ticks.filter(({ tickMs, status }) => status === 'failure' && tickMs > previousClosure && tickMs < closed)
    : [];
  const evidence = [...failureTicks, ...recoveredFailures].map(tick => tick.tickMs);
  if (repeated) evidence.push(repeated.tickMs);
  const observedProblem = evidence.length ? Math.max(...evidence) : 0;

  let incident = previous?.incident_id ? {
    id: previous.incident_id, latest: previous.latest_problem_ms, state: previous.mail_state,
  } : null;
  if (incident && closed > incident.latest) incident = null;
  let notify = false;
  if (observedProblem && !incident) {
    incident = { id: crypto.randomUUID(), latest: observedProblem, state: 'claimed' };
    notify = true;
  } else if (observedProblem && incident) {
    incident.latest = Math.max(incident.latest, observedProblem);
  }

  const code = failureTicks.length ? 'CRON_FAILED'
    : recoveredFailures.length ? 'CRON_FAILED_RECOVERED'
    : repeated ? 'CRON_OVERDUE'
    : pending !== null ? 'CRON_MISSING_PENDING'
    : closed >= newest.tickMs ? 'CRON_OK' : 'CRON_CLEANUP_RECEIPT_UNAVAILABLE';
  const alert = notify ? {
    failedTicks: failureTicks.length + recoveredFailures.length,
    missingTicks: repeated ? 1 : 0,
    fromUtc: iso(Math.min(...evidence)),
    throughUtc: iso(observedProblem),
    ...(recoveredFailures.length ? { recovered: true } : {}),
  } : null;
  return { code, closed, pending, incident, alert };
}

async function withClaim({ operations, activationMs, pollMs, ticks, completion }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const gate = await operations.prepare('SELECT apply_enabled,apply_from_ms FROM cron_cleanup_control WHERE id=1').first();
    if (!gate || gate.apply_enabled !== 1 || gate.apply_from_ms !== activationMs) {
      return { terminal: result('CRON_WATCHDOG_INACTIVE') };
    }
    const stored = await operations.prepare('SELECT * FROM cron_watchdog_production_state WHERE id=1').first();
    if (stored && (stored.activation_ms > activationMs ||
      (stored.activation_ms === activationMs && stored.observed_at_ms >= pollMs))) {
      return { terminal: result('CRON_WATCHDOG_ALREADY_OBSERVED', 'suppressed') };
    }
    const next = decide(stored?.activation_ms === activationMs ? stored : null, ticks, completion);
    const { incident } = next;
    // Compare-and-set covers both overlapping observations and an email send
    // finishing while another observation is reading state.
    const claimed = await operations.prepare(`INSERT INTO cron_watchdog_production_state (
        id, revision, activation_ms, observed_at_ms, closed_through_ms, pending_missing_ms,
        incident_id, latest_problem_ms, mail_state
      ) SELECT 1, 1, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM cron_cleanup_control WHERE id=1 AND apply_enabled=1 AND apply_from_ms=?)
      ON CONFLICT(id) DO UPDATE SET revision=cron_watchdog_production_state.revision+1,
        activation_ms=excluded.activation_ms, observed_at_ms=excluded.observed_at_ms,
        closed_through_ms=excluded.closed_through_ms, pending_missing_ms=excluded.pending_missing_ms,
        incident_id=excluded.incident_id, latest_problem_ms=excluded.latest_problem_ms, mail_state=excluded.mail_state
      WHERE cron_watchdog_production_state.revision=? RETURNING revision`)
      .bind(activationMs, pollMs, next.closed, next.pending, incident?.id ?? null, incident?.latest ?? null,
        incident?.state ?? null, activationMs, stored?.revision ?? 0).first();
    if (claimed) return { next };
  }
  return { terminal: unavailable() };
}

export async function runProductionCronWatchdog({ operations, activationMs, observedAtMs, ticks, completion, sendAlert }) {
  const pollMs = Math.floor(observedAtMs / minute) * minute;
  if (!validObservation(activationMs, pollMs, ticks)) return result('CRON_METRICS_UNAVAILABLE');
  let claim;
  try {
    claim = await withClaim({ operations, activationMs, pollMs, ticks, completion });
  } catch { return unavailable(); }
  if (claim.terminal) return claim.terminal;
  const { code, incident, alert } = claim.next;
  if (!alert) return result(code, incident && (code === 'CRON_FAILED' || code === 'CRON_OVERDUE') ? 'suppressed' : 'none');

  let dispatch = 'accepted';
  try { await sendAlert(alert); } catch { dispatch = 'unconfirmed'; }
  try {
    const receipt = await operations.prepare(`UPDATE cron_watchdog_production_state
      SET mail_state=?, revision=revision+1 WHERE id=1 AND activation_ms=? AND incident_id=? AND mail_state='claimed'`)
      .bind(dispatch, activationMs, incident.id).run();
    if (!receipt.success || receipt.meta?.changes !== 1) return result(code, 'unconfirmed');
  } catch { return result(code, 'unconfirmed'); }
  return result(code, dispatch);
}
