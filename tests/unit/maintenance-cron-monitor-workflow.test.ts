import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

type Step = { run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = {
  permissions: Record<string, string>;
  on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
  jobs: { 'cron-monitor': { if: string; environment: string; steps: Step[] } };
};
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => Workflow };
const workflow = yaml.load(readFileSync('.github/workflows/maintenance-cron-monitor.yml', 'utf8'));
const job = workflow.jobs['cron-monitor'];

it('limits the job to main and explicit activation with a pre-checkout guard', () => {
  expect(workflow.on.schedule).toEqual([{ cron: '7,22,37,52 * * * *' }]);
  expect(workflow.on).toHaveProperty('workflow_dispatch');
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(job.if).toBe("${{ github.ref == 'refs/heads/main' && vars.KAIROS_CRON_MONITOR_ENABLED == 'true' }}");
  expect(job.environment).toBe('cron-monitor');
  expect(job.steps[0].run).toBe("test \"$GITHUB_REF\" = 'refs/heads/main' && test \"$KAIROS_CRON_MONITOR_ENABLED\" = 'true'");
  expect(job.steps[1].with).toMatchObject({ref: '${{ github.sha }}', 'persist-credentials': false});
});

it('exposes only the analytics credential and only to the monitor command', () => {
  const bindings = job.steps.flatMap((step) => {
    const secrets = Object.values(step.env ?? {}).filter(value => value.includes('secrets.'));
    return secrets.length ? [{ run: step.run, secrets }] : [];
  });
  expect(bindings).toEqual([
    { run: 'node scripts/check-maintenance-cron.mjs', secrets: ['${{ secrets.CLOUDFLARE_CRON_ANALYTICS_TOKEN }}'] },
  ]);
});
