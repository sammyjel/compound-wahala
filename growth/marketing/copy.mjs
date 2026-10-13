// Scripts, captions, titles, hashtags and concepts for one piece of content.
// Free templates by default (built only from the series' real game content). Optional AI
// alternatives via the Claude API when ANTHROPIC_API_KEY is set AND config.spend allows it.
import { spend } from '../lib/env.mjs';

/** The residents are AI-generated photoreal art — platforms require disclosing that. */
export const AI_NOTE = 'Character art is AI-generated.';
export const LIMITS = { youtubeTitle: 100, youtubeDesc: 5000, tiktok: 2200, instagram: 2200, facebook: 5000 };
/** Claims we never make: these are fictional skits. */
const BANNED = [/true story/i, /real(ly)? happened/i, /this happened to me/i, /real incident/i, /based on real events/i, /\bguaranteed\b/i, /\bwin money\b/i, /\bearn (real )?money\b/i];

export function link(base, platform, campaign, medium = 'social') {
  const u = new URL(base);
  u.searchParams.set('utm_source', platform);
  u.searchParams.set('utm_medium', medium);
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

/**
 * @param {object} series   entry from content/series.json
 * @param {object} o        { id, hookIndex, label, baseHashtags, landing }
 */
export function templateCopy(series, o) {
  const hook = series.hooks[o.hookIndex % series.hooks.length];
  const tags = [...new Set([...o.baseHashtags, ...series.hashtags])];
  const shortTags = tags.slice(0, 6).join(' ');
  const yt = link(o.landing, 'youtube', o.id, 'shorts');
  const fb = link(o.landing, 'facebook', o.id, 'reels');
  const beats = series.beats.map((b, i) => `${i + 1}. ${b}`).join('\n');
  return {
    hook,
    title: series.title,
    script: [
      `# ${series.title} — vertical short (≈30–45s)`,
      '',
      `**Hook (0–3s, on screen):** ${hook}`,
      '',
      '**Beats (real gameplay, recorded automatically):**',
      beats,
      '',
      `**End card (last 3s):** COMPOUND WAHALA — Play free in your browser`,
      `**Spoken / pinned question:** ${series.question}`,
      '',
      `**Label (always visible):** ${o.label}`,
    ].join('\n'),
    platforms: {
      youtube: {
        title: `${hook} | Compound Wahala #shorts`.slice(0, LIMITS.youtubeTitle),
        description: `${series.question}\n\n🎮 Play free in your browser (no download): ${yt}\n\n${o.label}. ${AI_NOTE} A comedy game about Nigerian compound life.\n\n${tags.join(' ')}`,
        tags: tags.map((t) => t.replace('#', '')),
      },
      tiktok: { caption: `${hook} 😂 ${series.question}\n🎮 Play free — link in bio\n${o.label}. ${AI_NOTE}\n${shortTags}`, link: link(o.landing, 'tiktok', 'bio') },
      instagram: { caption: `${hook}\n\n${series.question}\n\n🎮 Play free in your browser — link in bio\n${o.label}. ${AI_NOTE}\n\n${tags.join(' ')}`, link: link(o.landing, 'instagram', 'bio') },
      facebook: { caption: `${hook}\n\n${series.question}\n\n🎮 Play free: ${fb}\n${o.label}. ${AI_NOTE}`, link: fb },
    },
    hashtags: tags,
    thumbnail: `Celebration frame from the level with the title "${series.title}" in big gold letters on a dark band. Faces of the residents visible, bright compound lighting.`,
    imagePost: `Square post: screenshot of the funniest wrong-answer reply from "${series.title}" with the question "${series.question}" on top and "Play free · link in bio" at the bottom. ${o.label}.`,
    videoConcept: `${series.title}: open on "${hook}", show the wrong choice and its funny reply, then the fix and the celebration. End card with the call to action.`,
  };
}

/** Problems that block publishing. */
export function validateCopy(c, label) {
  const issues = [];
  const all = [c.hook, c.script, c.platforms.youtube.title, c.platforms.youtube.description, c.platforms.tiktok.caption, c.platforms.instagram.caption, c.platforms.facebook.caption].join('\n');
  for (const re of BANNED) if (re.test(all)) issues.push(`contains a claim we never make: ${re}`);
  if (c.platforms.youtube.title.length > LIMITS.youtubeTitle) issues.push('YouTube title too long');
  if (c.platforms.youtube.description.length > LIMITS.youtubeDesc) issues.push('YouTube description too long');
  for (const p of ['tiktok', 'instagram', 'facebook']) {
    if (c.platforms[p].caption.length > LIMITS[p]) issues.push(`${p} caption too long`);
    if (!c.platforms[p].caption.includes(label)) issues.push(`${p} caption missing the fiction/gameplay label`);
  }
  if (!c.platforms.youtube.description.includes(label)) issues.push('YouTube description missing the label');
  for (const p of ['tiktok', 'instagram', 'facebook']) if (!c.platforms[p].caption.includes(AI_NOTE)) issues.push(`${p} caption missing the AI-art disclosure`);
  if (!c.platforms.youtube.description.includes(AI_NOTE)) issues.push('YouTube description missing the AI-art disclosure');
  return issues;
}

/**
 * Optional: ask Claude for alternative hooks. Only the hooks are replaced; facts stay template-based.
 * Returns null when not configured or over budget (the free template is used instead).
 */
export async function aiHooks(series) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const budget = spend('ai', 0.02);
  if (!budget.ok) return null;
  const prompt = `You write short-video hooks for a comedy browser game about Nigerian compound life.\nSeries: ${series.title}\nWhat actually happens in the gameplay clip:\n${series.beats.join('\n')}\nWrite 3 hooks (max 60 characters each), playful, family-friendly, may use light Nigerian Pidgin. Never claim it is a true story or real event. Return ONLY a JSON array of strings.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error('Claude API ' + r.status);
  const j = await r.json();
  const text = j.content?.map((c) => c.text || '').join('') || '[]';
  const hooks = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  return Array.isArray(hooks) ? hooks.filter((h) => typeof h === 'string' && h.length <= 80 && !BANNED.some((re) => re.test(h))).slice(0, 3) : null;
}
