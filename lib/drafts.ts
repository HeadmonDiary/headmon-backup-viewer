import type { BackupManifest, PortableDiary, WeatherRecord } from "./backup";

const DATABASE_NAME = "headmon-backup-workbench";
const STORE_NAME = "drafts";
const DATABASE_VERSION = 1;

export interface BackupDraft {
  id: string;
  fileName: string;
  sourceBlob: Blob;
  savedAtEpochMillis: number;
  diary: PortableDiary;
  manifest: BackupManifest;
  weather: WeatherRecord[];
  modifiedDates?: string[];
}

export interface BackupDraftSummary {
  id: string;
  fileName: string;
  savedAtEpochMillis: number;
  dayCount: number;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage could not be opened."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage failed."));
  });
}

export function draftIdForFile(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function saveDraft(draft: BackupDraft): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(draft));
  } finally {
    db.close();
  }
}

export async function loadDraft(id: string): Promise<BackupDraft | null> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    return (await requestResult(transaction.objectStore(STORE_NAME).get(id))) ?? null;
  } finally {
    db.close();
  }
}

export async function listDrafts(): Promise<BackupDraftSummary[]> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const records = await requestResult<BackupDraft[]>(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    return records
      .map((draft) => ({
        id: draft.id,
        fileName: draft.fileName,
        savedAtEpochMillis: draft.savedAtEpochMillis,
        dayCount: draft.diary.days.length,
      }))
      .sort((left, right) => right.savedAtEpochMillis - left.savedAtEpochMillis);
  } finally {
    db.close();
  }
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}
