import { runMaintenanceCronCleanup } from './lib/maintenance-cron-cleanup.mjs';

const cleanup = {
  async scheduled(controller, env) {
    await runMaintenanceCronCleanup({ controller, env });
  },
};

export default cleanup;
