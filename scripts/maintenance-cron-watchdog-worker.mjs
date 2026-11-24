import { EmailMessage } from 'cloudflare:email';
import { observeMaintenanceCron } from './lib/maintenance-cron-observation.mjs';
import { runMaintenanceCronWatchdog } from './lib/maintenance-cron-watchdog.mjs';

const sender = 'support@mykairos.me';
const configurationError = () => new Error('CRON_WATCHDOG_CONFIG_INVALID');

function sendCleanupAlert(env, destination, { failedTicks, missingTicks, fromUtc, throughUtc }) {
  const body = [
    `From: ${sender}`,
    'To: undisclosed-recipients:;',
    'Subject: Kairos scheduled cleanup watchdog test',
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@mykairos.me>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `${failedTicks} failed cleanup invocation(s)`,
    `${missingTicks} missing cleanup invocation(s)`,
    `Observation window ${fromUtc} through ${throughUtc}`,
    '',
  ].join('\r\n');
  return env.EMAIL.send(new EmailMessage(sender, destination, body));
}

const watchdog = {
  async scheduled(controller, env) {
    if (env.KAIROS_CRON_WATCHDOG_ENABLED !== 'true' || env.KAIROS_CRON_WATCHDOG_PILOT !== 'true') return;
    const nowMs = Date.now();
    const runTime = controller.scheduledTime;
    if (!env.KAIROS_CRON_WATCHDOG_TRIGGER || controller.cron !== env.KAIROS_CRON_WATCHDOG_TRIGGER
      || !Number.isSafeInteger(runTime) || runTime <= 0 || runTime > nowMs + 15_000) return;
    const start = Date.parse(env.KAIROS_CRON_WATCHDOG_NOT_BEFORE_UTC);
    const end = Date.parse(env.KAIROS_CRON_WATCHDOG_EXPIRES_UTC);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 20 * 60_000) {
      throw configurationError();
    }
    if (nowMs < start || runTime < start || nowMs >= end || runTime >= end) return;
    const destination = env.KAIROS_CRON_WATCHDOG_RECIPIENT;
    if (!env.WATCHDOG_STATE || !env.EMAIL || typeof destination !== 'string'
      || !/^[A-Za-z0-9._%+!-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(destination)) throw configurationError();

    const observation = await observeMaintenanceCron({ env, nowMs });
    // The disposable run may send at most one message. Preserve its first
    // durable claim even if a later observation happens to look healthy.
    if (observation.code === 'CRON_OK') return;
    const result = await runMaintenanceCronWatchdog({
      db: env.WATCHDOG_STATE, observedAtMs: runTime, observation,
      sendAlert: (details) => sendCleanupAlert(env, destination, details),
    });
    if (result.dispatch === 'unconfirmed') throw new Error('CRON_WATCHDOG_DELIVERY_UNCONFIRMED');
    if (['CRON_WATCHDOG_STATE_UNAVAILABLE', 'CRON_MONITOR_CONFIG_INVALID', 'CRON_METRICS_UNAVAILABLE'].includes(result.code)) {
      throw new Error(result.code);
    }
  },
};

export default watchdog;
