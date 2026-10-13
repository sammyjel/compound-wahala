// Tiny DOM helpers. No framework — the UI is small and this keeps the build light.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error('Missing element ' + sel);
  return el as HTMLElement;
}

const P = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;

export const ICON = {
  cash: P('<rect x="2" y="6" width="20" height="12" rx="2" fill="#2e9e5b"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="900" fill="#fff" font-family="sans-serif">₦</text>'),
  happiness: P('<circle cx="12" cy="12" r="10" fill="#ffc83d"/><circle cx="8.5" cy="10" r="1.4" fill="#4a2a10"/><circle cx="15.5" cy="10" r="1.4" fill="#4a2a10"/><path d="M7.5 14q4.5 4 9 0" stroke="#4a2a10" stroke-width="1.8" fill="none" stroke-linecap="round"/>'),
  reputation: P('<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" fill="#f2b632" stroke="#a8751a" stroke-width="1"/>'),
  fuel: P('<rect x="4" y="6" width="13" height="15" rx="2" fill="#e1b12c" stroke="#7a5c10"/><rect x="7" y="3" width="5" height="3" fill="#7a5c10"/><path d="M17 9l3 2v7a2 2 0 0 1-2 2" stroke="#7a5c10" stroke-width="1.6" fill="none"/>'),
  water: P('<path d="M12 2C9 7 5 10.5 5 14.5A7 7 0 0 0 19 14.5C19 10.5 15 7 12 2z" fill="#3fa7f5" stroke="#1565c0"/>'),
  condition: P('<path d="M3 11l9-7 9 7v10H3z" fill="#c8553d" stroke="#7a2e1e"/><rect x="10" y="14" width="4" height="7" fill="#f6d8a8"/>'),
  power: P('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="#ffd23f" stroke="#a37b00"/>'),
  nopower: P('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="#777" stroke="#444"/><path d="M3 3l18 18" stroke="#e74c3c" stroke-width="2.4"/>'),
  heart: P('<path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="#e74c3c"/>'),
  clock: P('<circle cx="12" cy="12" r="10" fill="#fff6e5" stroke="#2b1d14" stroke-width="1.6"/><path d="M12 6v6l4 2" stroke="#2b1d14" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  sun: P('<circle cx="12" cy="12" r="5" fill="#ffc83d"/><g stroke="#ffc83d" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g>'),
  moon: P('<path d="M20 15A8 8 0 1 1 9 4a6.5 6.5 0 0 0 11 11z" fill="#f4f1de"/>'),
  sound: P('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" fill="none"/>'),
};

export type IconKey = keyof typeof ICON;

export function icon(k: IconKey, cls = 'ico'): HTMLSpanElement {
  return h('span', { class: cls, html: ICON[k] });
}
