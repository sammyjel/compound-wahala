// Save/load + settings, isolated so storage can be swapped (e.g. cloud saves later).
import type { GameState } from '../types.ts';

const SAVE_KEY = 'compoundWahala.save.v1';
const SETTINGS_KEY = 'compoundWahala.settings.v1';

export interface Settings {
  textSize: 'small' | 'normal' | 'large' | 'xl';
  music: boolean;
  musicVolume: number;
  sound: boolean;
  translations: boolean;
  labels: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = { textSize: 'normal', music: true, musicVolume: 0.5, sound: true, translations: true, labels: true, reduceMotion: false };

function storage(): Storage | null {
  try {
    const k = '__cw_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function saveGame(s: GameState): boolean {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(SAVE_KEY, JSON.stringify({ savedAt: Date.now(), state: s }));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { state: GameState };
    if (!data?.state || data.state.version !== 1) return null;
    return data.state;
  } catch {
    return null;
  }
}

export function saveInfo(): { day: number; name: string; savedAt: number; ended: boolean } | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { savedAt: number; state: GameState };
    return { day: d.state.day, name: d.state.playerName, savedAt: d.savedAt, ended: d.state.ended };
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  storage()?.removeItem(SAVE_KEY);
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
