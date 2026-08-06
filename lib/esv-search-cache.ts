const DEFAULT_DATABASE = "bibleos-esv-search";
const STORE_NAME = "indexes";

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB failed to open."));
  });
}

export async function readEsvSearchCache(
  key: string,
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<string | null> {
  const database = await openDatabase(factory, databaseName);
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error || new Error("The ESV search cache could not be read."));
    });
  } finally {
    database.close();
  }
}

export async function writeEsvSearchCache(
  key: string,
  serialized: string,
  factory: IDBFactory = indexedDB,
  databaseName = DEFAULT_DATABASE,
): Promise<void> {
  const database = await openDatabase(factory, databaseName);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(serialized, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("The ESV search cache could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("The ESV search cache save was aborted."));
    });
  } finally {
    database.close();
  }
}
