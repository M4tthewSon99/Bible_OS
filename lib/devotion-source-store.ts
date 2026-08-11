/** Durable storage for the photographed page behind an imported devotion.
 *
 * This deliberately does not live in localStorage beside the devotion text.
 * A quota failure there is swallowed silently and would take the whole
 * devotion store down with it, so a page image — the largest thing the
 * feature keeps and the least essential — is isolated in IndexedDB where it
 * can fail on its own without costing the reader a word they wrote. */

const DEFAULT_DATABASE = "bibleos-devotion-sources";
const STORE_NAME = "pages";

/** A month of daily handouts at roughly 180 KB each. Past that the oldest
 * pages are dropped: an imported page's answers are the durable record, and
 * its photo is only ever needed to check a transcription. */
const KEEP_PAGES = 31;

export interface DevotionSourcePage {
  date: string;
  blob: Blob;
  width: number;
  height: number;
  savedAt: string;
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("The devotion page store failed to open."));
  });
}

function request<T>(source: IDBRequest<T>, failure: string): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error || new Error(failure));
  });
}

function committed(transaction: IDBTransaction, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(failure));
    transaction.onabort = () => reject(transaction.error || new Error(`${failure} The change was rolled back.`));
  });
}

/**
 * Every operation here is the same three moves — open, work, close — around a
 * different middle. Only a write waits for the transaction to commit: a read
 * has nothing to lose if it never does, and making it wait would add a round
 * trip to the one call that happens while the reader is looking at a button.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  factory: IDBFactory,
  databaseName: string,
  failure: string,
  work: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase(factory, databaseName);
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await work(transaction.objectStore(STORE_NAME));
    if (mode === "readwrite") await committed(transaction, failure);
    return result;
  } finally {
    database.close();
  }
}

function isSourcePage(value: unknown): value is DevotionSourcePage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<DevotionSourcePage>;
  return typeof page.date === "string" && page.blob instanceof Blob;
}

/** Keys are written as ISO date strings, so this is also chronological order. */
function sortedDateKeys(keys: IDBValidKey[]): string[] {
  return keys.filter((key): key is string => typeof key === "string").sort();
}

export function readDevotionSource(
  date: string,
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<DevotionSourcePage | null> {
  return withStore("readonly", factory, databaseName, "The devotion page could not be read.", async (store) => {
    const value = await request(store.get(date), "The devotion page could not be read.");
    return isSourcePage(value) ? value : null;
  });
}

/** Trims to the newest {@link KEEP_PAGES}. */
export function writeDevotionSource(
  page: DevotionSourcePage,
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<void> {
  return withStore("readwrite", factory, databaseName, "The devotion page could not be saved.", async (store) => {
    store.put(page, page.date);
    const stored = await request(store.getAllKeys(), "The devotion page store could not be trimmed.");
    const dates = sortedDateKeys(stored);
    const withNewest = dates.includes(page.date) ? dates : [...dates, page.date].sort();
    withNewest.slice(0, Math.max(0, withNewest.length - KEEP_PAGES)).forEach((key) => store.delete(key));
  });
}

/** Keys only. The panel needs to know *whether* a page was kept before it can
 * decide to offer it, and that answer should not cost a decode of every
 * stored image. */
export function listDevotionSourceDates(
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<string[]> {
  return withStore("readonly", factory, databaseName, "The devotion page list could not be read.", async (store) => {
    return sortedDateKeys(await request(store.getAllKeys(), "The devotion page list could not be read."));
  });
}

export function deleteDevotionSource(
  date: string,
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<void> {
  return withStore("readwrite", factory, databaseName, "The devotion page could not be removed.", (store) => {
    store.delete(date);
  });
}
