'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Valor persistido em localStorage, hidratação segura: o servidor vê o padrão,
// o cliente lê o storage depois de hidratar (sem setState dentro de effect).
const EVT = 'fbu-ls';

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(EVT, cb);
  return () => { window.removeEventListener('storage', cb); window.removeEventListener(EVT, cb); };
}

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sem storage */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* SSR */ }
}

export function useLocalValue(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => lsGet(key) ?? fallback,
    () => fallback,
  );
  const set = useCallback((v: string) => lsSet(key, v), [key]);
  return [value, set];
}
