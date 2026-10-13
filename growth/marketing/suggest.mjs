// WORKFLOW D — send the latest evidence-based suggestions to you (inbox + optional push).
// Read-only: it never edits config.json, never approves or publishes anything.
import { join } from 'node:path';
import { config, CONTENT, notify, readJson } from '../lib/env.mjs';

if (config().workflows?.paused) { console.log('Workflows paused.'); process.exit(0); }
const r = readJson(join(CONTENT, 'reports', 'latest.json'));
if (!r) { console.log('No report yet. Run npm run growth:report first.'); process.exit(0); }
const text = r.suggestions.join(' | ');
console.log(`Suggestions from ${r.date}:\n- ` + r.suggestions.join('\n- '));
await notify(`Weekly suggestions (${r.date})`, text);
