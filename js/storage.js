const DB_NAME = 'cardcheck-v1';
let db;
export async function openStorage() {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function readState(key, fallback) {
  if (!db) return Promise.resolve(fallback);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readonly');
    const request = transaction.objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(request.error);
  });
}
export function writeState(key, value) {
  if (!db) return Promise.reject(new Error('Browser storage is unavailable. Export a backup before leaving.'));
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite');
    transaction.objectStore('state').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage was interrupted.'));
  });
}
