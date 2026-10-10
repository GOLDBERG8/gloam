/**
 * Just enough of a browser for the self-tests that run app storage code in
 * Node: window events, localStorage, sessionStorage and the slice of
 * IndexedDB that lib/noteVault uses (one object store, get / put / delete).
 * Values are kept as they are (CryptoKeys included), like a structured clone.
 *
 * Import it before any app module: noteVault reads `window` when it loads.
 */

class MemoryStorage {
  #m = new Map<string, string>();
  get length() {
    return this.#m.size;
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.#m.has(k) ? this.#m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.#m.set(k, String(v));
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  clear() {
    this.#m.clear();
  }
}

type Req = {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
};

const databases = new Map<string, Map<string, Map<string, unknown>>>();

function later(fn: () => void) {
  setTimeout(fn, 0);
}

function storeApi(stores: Map<string, Map<string, unknown>>, name: string, tx: { oncomplete?: () => void }) {
  const store = stores.get(name)!;
  const done = (req: Req, value?: unknown) =>
    later(() => {
      req.result = value;
      req.onsuccess?.();
      tx.oncomplete?.();
    });
  return {
    get(id: string) {
      const req: Req = {};
      done(req, store.get(id));
      return req;
    },
    put(value: unknown, id: string) {
      store.set(id, value);
      const req: Req = {};
      done(req);
      return req;
    },
    delete(id: string) {
      store.delete(id);
      const req: Req = {};
      done(req);
      return req;
    },
  };
}

const indexedDB = {
  open(name: string) {
    const req: Req = {};
    later(() => {
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, new Map());
      const stores = databases.get(name)!;
      const db = {
        createObjectStore(store: string) {
          stores.set(store, new Map());
        },
        transaction(store: string) {
          const tx: { oncomplete?: () => void; onerror?: () => void; objectStore: (s: string) => unknown } = {
            objectStore: (s: string) => storeApi(stores, s ?? store, tx),
          };
          return tx;
        },
      };
      req.result = db;
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

const listeners = new Map<string, Set<(e: Event) => void>>();
const g = globalThis as Record<string, unknown>;
const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();

g.window = {
  localStorage,
  sessionStorage,
  location: new URL("https://gloam.trade/app/vault"),
  history: { state: null, replaceState() {} },
  addEventListener(type: string, fn: (e: Event) => void) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener(type: string, fn: (e: Event) => void) {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent(e: Event) {
    for (const fn of listeners.get(e.type) ?? []) fn(e);
    return true;
  },
};
g.localStorage = localStorage;
g.sessionStorage = sessionStorage;
g.indexedDB = indexedDB;

/** Forget everything stored (a fresh browser), keeping the same globals. */
export function resetBrowser() {
  localStorage.clear();
  sessionStorage.clear();
  databases.clear();
}

/** How many times `type` was dispatched on window from now on. */
export function countEvents(type: string): () => number {
  let n = 0;
  (g.window as { addEventListener: (t: string, f: () => void) => void }).addEventListener(type, () => {
    n++;
  });
  return () => n;
}

export { localStorage };
