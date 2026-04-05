// ============================================================
// Shared game state store for Boss Battle
//
// Uses a temp JSON file so state is shared across separate
// Vercel dev serverless function invocations.
// ============================================================

import fs from 'fs';
import path from 'path';
import { GameState, BossAction } from '../lib/types';

const STORE_PATH = path.join(process.cwd(), '.game-store.json');

interface StoreData {
  gameStates: Record<string, GameState>;
  pendingBitsActions: Record<string, BossAction[]>;
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as StoreData;
  } catch {
    return { gameStates: {}, pendingBitsActions: {} };
  }
}

function writeStore(data: StoreData): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/** Map-like wrapper that reads/writes from the shared file store */
function createStoreProxy<T>(key: 'gameStates' | 'pendingBitsActions') {
  return {
    get(id: string): T | undefined {
      const store = readStore();
      return (store[key] as Record<string, T>)[id];
    },
    set(id: string, value: T): void {
      const store = readStore();
      (store[key] as Record<string, T>)[id] = value;
      writeStore(store);
    },
    delete(id: string): boolean {
      const store = readStore();
      const existed = id in store[key];
      delete (store[key] as Record<string, T>)[id];
      writeStore(store);
      return existed;
    },
    has(id: string): boolean {
      const store = readStore();
      return id in store[key];
    },
  };
}

/** Active game states keyed by channel_id */
export const gameStates = createStoreProxy<GameState>('gameStates');

/** Pending bits-powered actions keyed by channel_id, applied at next resolveTurn */
export const pendingBitsActions = createStoreProxy<BossAction[]>('pendingBitsActions');
