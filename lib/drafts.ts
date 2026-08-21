const LEGACY_DATABASE_NAME = "headmon-backup-workbench";

/**
 * Versions published before 21 August 2026 saved complete health archives in
 * IndexedDB. The viewer is memory-only now, so remove those legacy drafts as
 * soon as the new viewer loads.
 */
export function deleteLegacyDraftDatabase(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(
      request.error ?? new Error("Legacy draft storage could not be removed."),
    );
    request.onblocked = () => {
      // Another viewer tab can temporarily hold the database open. The browser
      // completes the queued deletion when that tab releases it.
      resolve();
    };
  });
}
