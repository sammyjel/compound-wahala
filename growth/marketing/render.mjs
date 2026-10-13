// Turn recorded gameplay into a vertical short (1080x1920, H.264 + AAC) with:
// hook text, a persistent "gameplay · fictional characters" label, an end card with the
// call to action, and the game's own soundtrack. Also writes a thumbnail PNG.
// Uses the system ffmpeg/ffprobe (set FFMPEG / FFPROBE to override).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from '../lib/env.mjs';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const FONT = ['C:/Windows/Fonts/ariblk.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Black.ttf'].find((f) => existsSync(f));
export const MAX_SECONDS = 45;

/** ffmpeg filter paths need ':' and '\' escaped. */
const fpath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
/** drawtext can't render emoji; keep letters, digits and common punctuation. */
export const plainText = (s) => s.replace(/[^\p{L}\p{N}\s.,!?'"’“”…:;()&+\-–—/#@%·|]/gu, '').replace(/\s+/g, ' ').trim();

function wrap(text, max) {
  const words = plainText(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).join('\n');
}

export function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { width: v?.width, height: v?.height, duration: Number(j.format.duration), audio: j.streams.some((s) => s.codec_type === 'audio') };
}

/** Highlight cut from the capture marks: keep the moments that matter (talk openers, goals,
 *  wrong answers + their funny reply, taps, the win) and drop waiting time. Returns segments in
 *  source seconds, plus a gentle speed-up only if still too long. */
export function plan(marks) {
  const W = { say: [0.2, 2.6], banner: [0.1, 2.2], goal: [0.3, 2.4], wrong: [0.2, 5.5], tap: [0.3, 2.2], complete: [0.5, 2.8] };
  const end = marks[marks.length - 1].t;
  const first = marks.findIndex((m) => m.type === 'say' || m.type === 'goal');
  const raw = [];
  const done = marks.findIndex((m) => m.type === 'complete');
  const lastSay = marks.slice(0, done < 0 ? marks.length : done).map((m, i) => [m, i]).filter(([m]) => m.type === 'say').pop()?.[1];
  marks.forEach((m, i) => {
    const w = W[m.type];
    if (!w) return;
    // Talk is only kept for the opener and the final celebration line (wrong-answer replies are inside the 'wrong' window).
    if (m.type === 'say' && i !== first && i !== lastSay) return;
    const len = i === first ? 4.5 : w[1];
    raw.push([Math.max(0, m.t - w[0]), Math.min(end, m.t + len)]);
  });
  raw.sort((x, y) => x[0] - y[0]);
  const segs = [];
  for (const r of raw) {
    const last = segs[segs.length - 1];
    if (last && r[0] <= last[1] + 0.6) last[1] = Math.max(last[1], r[1]);
    else segs.push([...r]);
  }
  const total = segs.reduce((a, [x, y]) => a + (y - x), 0);
  const speed = Math.min(1.35, Math.max(1, total / (MAX_SECONDS - 4)));
  return { segs, speed, out: total / speed + 3 /* end card */ };
}

/**
 * @param {object} o
 * @param {string} o.video   source webm
 * @param {Array}  o.marks   capture timeline
 * @param {string} o.hook    big text at the start
 * @param {string} o.title   small series title shown after the hook
 * @param {string} o.label   honesty label
 * @param {string} o.cta     end card line
 * @param {string} o.url     end card link text
 * @param {string} o.music   track name in public/music (no extension)
 * @param {string} o.out     output mp4
 */
export function render(o) {
  if (!FONT) throw new Error('No bold font found for captions (set a FONT path in render.mjs)');
  mkdirSync(dirname(o.out), { recursive: true });
  const p = plan(o.marks);
  const dur = p.out;
  const tdir = dirname(o.out);
  const tf = (name, text) => { const f = join(tdir, name); writeFileSync(f, text); return fpath(f); };
  const hookF = tf('_hook.txt', wrap(o.hook, 22));
  const labelF = tf('_label.txt', plainText(o.label));
  const ctaF = tf('_cta.txt', wrap(o.cta, 18));
  const urlF = tf('_url.txt', plainText(o.url));
  const font = fpath(FONT);
  const endAt = (dur - 3).toFixed(2);
  const vf = [
    `[0:v]split=${p.segs.length}${p.segs.map((_, i) => `[s${i}]`).join('')}`,
    ...p.segs.map(([x, y], i) => `[s${i}]trim=start=${x.toFixed(2)}:end=${y.toFixed(2)},setpts=PTS-STARTPTS[c${i}]`),
    `${p.segs.map((_, i) => `[c${i}]`).join('')}concat=n=${p.segs.length}:v=1:a=0,setpts=PTS/${p.speed.toFixed(3)},fps=30,scale=1012:1800:flags=lanczos,pad=1080:1920:34:0:color=0x143F2F,setsar=1,tpad=stop_mode=clone:stop=90[base]`,
    `[base]drawbox=x=0:y=150:w=iw:h=330:color=black@0.55:t=fill:enable='lt(t,3.8)',` +
      `drawtext=fontfile='${font}':textfile='${hookF}':fontsize=76:fontcolor=white:line_spacing=14:text_align=C:x=(w-text_w)/2:y=190:borderw=5:bordercolor=black:enable='lt(t,3.8)',` +
      `drawtext=fontfile='${font}':textfile='${labelF}':fontsize=34:fontcolor=white:x=(w-text_w)/2:y=1842,` +
      `drawbox=x=0:y=0:w=iw:h=ih:color=0x1F6F50@0.93:t=fill:enable='gte(t,${endAt})',` +
      `drawtext=fontfile='${font}':text='COMPOUND':fontsize=110:fontcolor=0xFFF6E5:x=(w-text_w)/2:y=560:enable='gte(t,${endAt})',` +
      `drawtext=fontfile='${font}':text='WAHALA':fontsize=150:fontcolor=0xF2B632:x=(w-text_w)/2:y=690:borderw=6:bordercolor=0x8A5A00:enable='gte(t,${endAt})',` +
      `drawtext=fontfile='${font}':textfile='${ctaF}':fontsize=70:fontcolor=white:line_spacing=12:text_align=C:x=(w-text_w)/2:y=960:enable='gte(t,${endAt})',` +
      `drawtext=fontfile='${font}':textfile='${urlF}':fontsize=38:fontcolor=0xFFE08A:x=(w-text_w)/2:y=1240:enable='gte(t,${endAt})'[v]`,
  ].join(';');
  const music = join(ROOT, 'public', 'music', `${o.music || 'day'}.mp3`);
  const args = ['-y', '-v', 'error', '-i', o.video];
  const hasMusic = existsSync(music);
  if (hasMusic) args.push('-stream_loop', '-1', '-i', music);
  const af = hasMusic ? `;[1:a]atrim=0:${dur.toFixed(2)},volume=0.7,afade=t=in:d=0.6,afade=t=out:st=${(dur - 1.5).toFixed(2)}:d=1.5[a]` : '';
  args.push('-filter_complex', vf + af, '-map', '[v]');
  if (hasMusic) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '128k');
  args.push('-t', dur.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.out);
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return { ...p, duration: dur };
}

/** Thumbnail: a frame from the celebration with the title on top. */
export function thumbnail({ video, at, title, out }) {
  const tf = join(dirname(out), '_thumb.txt');
  writeFileSync(tf, wrap(title, 16));
  const vf = `scale=1080:1920:flags=lanczos,drawbox=x=0:y=1180:w=iw:h=520:color=black@0.55:t=fill,drawtext=fontfile='${fpath(FONT)}':textfile='${fpath(tf)}':fontsize=96:fontcolor=0xF2B632:line_spacing=16:text_align=C:x=(w-text_w)/2:y=1230:borderw=6:bordercolor=black`;
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', String(Math.max(0, at)), '-i', video, '-frames:v', '1', '-vf', vf, out], { stdio: ['ignore', 'ignore', 'pipe'] });
  return out;
}
