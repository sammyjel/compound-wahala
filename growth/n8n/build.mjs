// Writes the importable n8n workflows (n8n → Workflows → Import from file).
// They run the growth scripts on THIS computer, so use a self-hosted n8n here (free):
//   npx n8n   (then allow the Execute Command node: N8N_NODES_EXCLUDE="[]" in n8n ≥ 2.0)
// n8n Cloud cannot run local commands or reach 127.0.0.1 — see growth/README.md.
// Every workflow honours config.json (pause / kill switch) because the scripts check it themselves.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GROWTH, ROOT } from '../lib/env.mjs';

const cwd = ROOT.replace(/\\/g, '/');
function workflow(name, cron, command, note) {
  return {
    name,
    nodes: [
      { parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } }, name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0] },
      { parameters: { command: `cd "${cwd}" && ${command}` }, name: 'Run script', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, position: [240, 0], continueOnFail: true },
      { parameters: { conditions: { number: [{ value1: '={{$json.exitCode ?? ($json.error ? 1 : 0)}}', operation: 'notEqual', value2: 0 }] } }, name: 'Failed?', type: 'n8n-nodes-base.if', typeVersion: 1, position: [480, 0] },
      { parameters: { method: 'POST', url: '={{$env.NOTIFY_WEBHOOK}}', sendBody: true, contentType: 'raw', rawContentType: 'text/plain', body: `=${name} failed: {{ ($json.stderr || $json.error?.message || '').slice(0, 300) }}` }, name: 'Notify me', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [720, -80] },
      { parameters: { content: note, height: 220, width: 380 }, name: 'About', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, 180] },
    ],
    connections: {
      Schedule: { main: [[{ node: 'Run script', type: 'main', index: 0 }]] },
      'Run script': { main: [[{ node: 'Failed?', type: 'main', index: 0 }]] },
      'Failed?': { main: [[{ node: 'Notify me', type: 'main', index: 0 }], []] },
    },
    settings: { executionOrder: 'v1', timezone: 'Africa/Lagos' },
    active: false,
  };
}

const flows = {
  'A-content-generation.json': workflow('Compound Wahala · A · Content generation', '0 9 * * 1', 'npm run build && npm run growth:generate -- --days 7',
    'Every Monday 09:00 (Lagos): rebuild the game, record fresh gameplay if needed, render a week of shorts and captions, validate them and put them in the review queue as DRAFTS. Nothing is published here. You get a notification to review.'),
  'B-publishing.json': workflow('Compound Wahala · B · Publishing', '0 */2 * * *', 'npm run growth:publish',
    'Every 2 hours: approved + validated items due in the next 24h are posted via official APIs (YouTube only, when you enable it) or turned into manual posting tasks. Stops completely while the kill switch in growth/config.json is ON (default).'),
  'C-performance-report.json': workflow('Compound Wahala · C · Weekly report', '0 8 * * 1', 'npm run growth:report',
    'Every Monday 08:00: pulls real post stats (YouTube API, your metrics.csv) and game analytics, writes growth/content/reports/<date>.md.'),
  'D-improvement.json': workflow('Compound Wahala · D · Suggestions digest', '30 8 * * 1', 'node growth/marketing/suggest.mjs',
    'Every Monday 08:30: sends you the suggestions from the latest report (hooks, lengths, posting times, series). It never changes settings or publishes experiments by itself.'),
};
for (const [file, wf] of Object.entries(flows)) writeFileSync(join(GROWTH, 'n8n', file), JSON.stringify(wf, null, 2));
console.log('wrote', Object.keys(flows).join(', '));
