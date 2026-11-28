import { EmailMessage } from 'cloudflare:email';
import { observeHourlyMaintenanceCron } from './lib/maintenance-cron-observation.mjs';
import { runProductionCronWatchdog } from './lib/maintenance-cron-production-watchdog.mjs';

const minute = 60_000;
const watchdogCron = '4,19,34,49 * * * *';
const sender = 'support@mykairos.me';
const fixedError = code => new Error(code);

async function readCleanupControl(operations) {
  try {
    return await operations.prepare(`SELECT apply_enabled,apply_from_ms,last_tick_ms,state
      FROM cron_cleanup_control WHERE id=1`).first();
  } catch { throw fixedError('CRON_WATCHDOG_STATE_UNAVAILABLE'); }
}

function sendCleanupAlert(env, destination, details) {
  const body = [
    `From: ${sender}`,
    'To: undisclosed-recipients:;',
    'Subject: Kairos scheduled cleanup alert',
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@mykairos.me>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `${details.failedTicks} failed cleanup invocation(s)`,
    `${details.missingTicks} missing cleanup invocation(s)`,
    `Observation window ${details.fromUtc} through ${details.throughUtc}`,
    ...(details.recovered ? ['A later cleanup completed successfully.'] : []),
    '',
  ].join('\r\n');
  return env.EMAIL.send(new EmailMessage(sender, destination, body));
}

const watchdog = {
  async scheduled(controller, env) {
    if (env.KAIROS_CRON_PRODUCTION_WATCHDOG_ENABLED !== 'true') return;
    const nowMs = Date.now();
    const runTime = controller.scheduledTime;
    if (controller.cron !== watchdogCron || !Number.isSafeInteger(runTime) || runTime <= 0
      || Math.floor(runTime / minute) % 15 !== 4 || runTime > nowMs + 15_000 || nowMs - runTime > 5 * minute) return;

    const gate = await readCleanupControl(env.OPERATIONS);
    if (!gate || gate.apply_enabled !== 1) return;
    const activationMs = gate.apply_from_ms;
    const destination = env.KAIROS_CRON_WATCHDOG_RECIPIENT;
    if (!Number.isSafeInteger(activationMs) || activationMs <= 0 || activationMs % (60 * minute) !== 17 * minute
      || !env.EMAIL || typeof destination !== 'string'
      || !/^[A-Za-z0-9._%+!-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(destination)) {
      throw fixedError('CRON_WATCHDOG_CONFIG_INVALID');
    }

    const observation = await observeHourlyMaintenanceCron({ env: {
      CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID: env.CLOUDFLARE_CRON_ANALYTICS_ACCOUNT_ID,
      CLOUDFLARE_CRON_ANALYTICS_TOKEN: env.CLOUDFLARE_CRON_ANALYTICS_TOKEN,
      KAIROS_CRON_MONITOR_WORKER: env.KAIROS_CRON_MONITOR_WORKER,
      KAIROS_CRON_MONITOR_FIRST_TICK_UTC: new Date(activationMs).toISOString(),
      KAIROS_CRON_MONITOR_INTERVAL_MINUTES: '60',
    }, nowMs: Math.floor(runTime / minute) * minute });
    if (observation.code === 'CRON_NOT_DUE') return;
    if (!('ticks' in observation)) throw fixedError(observation.code);

    const completion = await readCleanupControl(env.OPERATIONS);
    if (!completion || completion.apply_enabled !== 1 || completion.apply_from_ms !== activationMs) return;
    const result = await runProductionCronWatchdog({
      operations: env.OPERATIONS, activationMs, observedAtMs: runTime, ticks: observation.ticks, completion,
      sendAlert: details => sendCleanupAlert(env, destination, details),
    });
    if (result.dispatch === 'unconfirmed') throw fixedError('CRON_WATCHDOG_DELIVERY_UNCONFIRMED');
    if (['CRON_WATCHDOG_STATE_UNAVAILABLE', 'CRON_METRICS_UNAVAILABLE', 'CRON_CLEANUP_RECEIPT_UNAVAILABLE'].includes(result.code)) {
      throw fixedError(result.code);
    }
  },
};

export default watchdog;
