import { sfx } from '../audio/sfx.ts';
import { clear, h } from './dom.ts';

export interface ModalAction {
  label: string;
  hint?: string;
  plain?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: string | null;
  /** Return false to keep the modal open. */
  onClick: () => void | boolean;
}

export interface ModalOpts {
  title: string;
  kicker?: string;
  body?: Node | Node[];
  actions?: ModalAction[];
  dismissable?: boolean;
  className?: string;
  onClose?: () => void;
  numbered?: boolean;
}

export interface ModalHandle {
  el: HTMLElement;
  close: () => void;
  setBody: (b: Node | Node[]) => void;
  setActions: (a: ModalAction[], numbered?: boolean) => void;
}

const stack: ModalHandle[] = [];

export function modalOpen(): boolean {
  return stack.length > 0;
}

export function topModal(): ModalHandle | null {
  return stack[stack.length - 1] ?? null;
}

export function closeTopModal(): boolean {
  const m = topModal();
  if (!m || m.el.dataset.dismissable !== '1') return false;
  m.close();
  return true;
}

export function choiceButton(a: ModalAction, n: number | null, after: () => void): HTMLButtonElement {
  const b = h(
    'button',
    {
      class: `choice${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
      type: 'button',
      disabled: !!a.disabled,
      'data-key': n ?? undefined,
      title: a.disabled ?? undefined,
    },
    n ? h('span', { class: 'kbd', 'aria-hidden': 'true' }, String(n)) : null,
    h(
      'span',
      { class: 'choice-text' },
      h('span', { class: 'choice-label' }, a.label),
      a.plain ? h('span', { class: 'plain' }, a.plain) : null,
      a.disabled ? h('span', { class: 'choice-hint blocked' }, '🔒 ' + a.disabled) : a.hint ? h('span', { class: 'choice-hint' }, a.hint) : null,
    ),
  );
  b.addEventListener('click', () => {
    if (a.disabled) return;
    sfx.click();
    const r = a.onClick();
    if (r !== false) after();
  });
  return b;
}

export function openModal(o: ModalOpts): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const bodyEl = h('div', { class: 'modal-body' });
  const actionsEl = h('div', { class: 'modal-actions' });
  const titleId = 'mt-' + Math.random().toString(36).slice(2);
  const card = h(
    'div',
    { class: `modal ${o.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    o.kicker ? h('div', { class: 'modal-kicker' }, o.kicker) : null,
    h('h2', { id: titleId, class: 'modal-title' }, o.title),
    bodyEl,
    actionsEl,
  );
  const backdrop = h('div', { class: 'modal-backdrop', 'data-dismissable': o.dismissable ? '1' : '0' }, card);
  if (o.dismissable) {
    card.prepend(h('button', { class: 'modal-x', type: 'button', 'aria-label': 'Close', onclick: () => handle.close() }, '×'));
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) handle.close();
    });
  }

  let closed = false;
  const handle: ModalHandle = {
    el: backdrop,
    close: () => {
      if (closed) return;
      closed = true;
      backdrop.remove();
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      o.onClose?.();
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      window.dispatchEvent(new Event('cw:modal-closed'));
    },
    setBody: (b) => {
      clear(bodyEl);
      for (const n of Array.isArray(b) ? b : [b]) bodyEl.append(n);
    },
    setActions: (acts, numbered = o.numbered) => {
      clear(actionsEl);
      acts.forEach((a, i) => actionsEl.append(choiceButton(a, numbered ? i + 1 : null, () => handle.close())));
      const first = actionsEl.querySelector('button:not([disabled])') as HTMLButtonElement | null;
      first?.focus({ preventScroll: true });
    },
  };
  if (o.body) handle.setBody(o.body);
  document.getElementById('modal-root')!.append(backdrop);
  stack.push(handle);
  handle.setActions(o.actions ?? [], o.numbered);
  if (!o.actions?.length) (card.querySelector('button') as HTMLElement | null)?.focus();
  return handle;
}

export function confirmDialog(title: string, text: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      body: h('p', {}, text),
      dismissable: true,
      onClose: () => { if (!answered) resolve(false); },
      actions: [
        { label: okLabel, danger, primary: !danger, onClick: () => { answered = true; resolve(true); } },
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
      ],
    });
  });
}

/** Keep keyboard focus inside the top modal. */
export function trapFocus(e: KeyboardEvent): void {
  const m = topModal();
  if (!m || e.key !== 'Tab') return;
  const f = Array.from(m.el.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]'));
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  else if (!m.el.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
}
