/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  DocumentData,
  QuerySnapshot
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { BACKUP_SEED_DATA } from './seedBackup';

// 1. Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// 2. Initialize Firestore with specific database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export interface SyncEvent {
  type: 'upsert' | 'delete';
  item?: any;
  id?: string;
}

export interface BackendHandler {
  (event: SyncEvent): void;
}

export interface TableBatchEvent {
  table: string;
  upserts: any[];
  deletes: string[];
}

export interface CloudBackend {
  kind: 'firebase';
  id: string;
  fetchAll(table: string): Promise<any[]>;
  upsert(table: string, items: any[], opts?: { excludeFields?: string[] }): Promise<void>;
  remove(table: string, ids: string[]): Promise<void>;
  adjustStock(productId: string, delta: number): Promise<number>;
  subscribe(table: string, callback: (event: { upserts: any[]; deletes: string[] }) => void): () => void;
  onConnection(callback: (connected: boolean) => void): () => void;
}

class FirestoreBackend implements CloudBackend {
  kind = 'firebase' as const;
  id = 'firestore-' + Math.random().toString(36).slice(2, 9);
  private connCbs = new Set<(connected: boolean) => void>();
  private isOnline = true;
  private hasSeeded = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
    }
  }

  private setOnline(status: boolean) {
    this.isOnline = status;
    this.connCbs.forEach(cb => {
      try {
        cb(status);
      } catch (err) {
        console.error('Connection cb error:', err);
      }
    });
  }

  onConnection(callback: (connected: boolean) => void): () => void {
    this.connCbs.add(callback);
    callback(this.isOnline);
    return () => this.connCbs.delete(callback);
  }

  async fetchAll(table: string): Promise<any[]> {
    try {
      const colRef = collection(db, table);
      const snapshot = await getDocs(colRef);
      const items: any[] = [];
      snapshot.forEach(docSnap => {
        items.push({ id: docSnap.id, ...docSnap.data() });
      });

      // If remote collection is completely empty, seed it automatically from BACKUP_SEED_DATA
      if (items.length === 0 && !this.hasSeeded) {
        console.log(`[Firestore] Remote collection '${table}' is empty, checking initial seed...`);
        if (table === 'products' && BACKUP_SEED_DATA.products?.length) {
          await this.batchSeed('products', BACKUP_SEED_DATA.products);
          return BACKUP_SEED_DATA.products;
        } else if (table === 'settings' && BACKUP_SEED_DATA.storeSettings) {
          const settingItem = { id: '1', ...BACKUP_SEED_DATA.storeSettings };
          await setDoc(doc(db, 'settings', '1'), settingItem);
          return [settingItem];
        } else if (table === 'users' && BACKUP_SEED_DATA.users?.length) {
          await this.batchSeed('users', BACKUP_SEED_DATA.users);
          return BACKUP_SEED_DATA.users;
        }
      }

      return items;
    } catch (err) {
      console.warn(`[Firestore] fetchAll '${table}' fallback to local storage:`, err);
      try {
        const local = localStorage.getItem(`sandikale_pos_${table}`);
        if (local) return JSON.parse(local);
      } catch {}
      return [];
    }
  }

  private async batchSeed(table: string, items: any[]) {
    try {
      const chunkSize = 400;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const docRef = doc(db, table, String(item.id));
          batch.set(docRef, item);
        }
        await batch.commit();
      }
      console.log(`[Firestore] Auto-seeded ${items.length} items to '${table}' successfully.`);
    } catch (err) {
      console.error(`[Firestore] Failed to batch seed '${table}':`, err);
    }
  }

  async upsert(table: string, items: any[], opts?: { excludeFields?: string[] }): Promise<void> {
    if (!items || items.length === 0) return;

    try {
      // Chunk writes in batches of 400 to respect Firestore limit of 500
      const chunkSize = 400;
      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        for (const rawItem of chunk) {
          const id = String(rawItem.id || 'doc_' + Math.random().toString(36).slice(2));
          let item = { ...rawItem, id };

          if (opts?.excludeFields) {
            for (const field of opts.excludeFields) {
              delete item[field];
            }
          }

          // Clean any undefined fields which Firestore rejects
          const cleanItem = Object.fromEntries(
            Object.entries(item).filter(([_, v]) => v !== undefined)
          );

          const docRef = doc(db, table, id);
          batch.set(docRef, cleanItem, { merge: true });
        }

        await batch.commit();
      }
    } catch (err) {
      console.error(`[Firestore] Failed to upsert to '${table}':`, err);
      throw err;
    }
  }

  async remove(table: string, ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        const docRef = doc(db, table, String(id));
        batch.delete(docRef);
      }
      await batch.commit();
    } catch (err) {
      console.error(`[Firestore] Failed to remove from '${table}':`, err);
      throw err;
    }
  }

  async adjustStock(productId: string, delta: number): Promise<number> {
    try {
      const docRef = doc(db, 'products', String(productId));
      const colRef = collection(db, 'products');
      const snap = await getDocs(colRef);
      let found: any = null;
      snap.forEach(d => {
        if (d.id === String(productId)) found = d.data();
      });

      const currentStock = found ? Number(found.stock || 0) : 0;
      const newStock = Math.max(0, currentStock + delta);
      await setDoc(docRef, { stock: newStock }, { merge: true });
      return newStock;
    } catch (err) {
      console.error('[Firestore] Failed to adjust stock:', err);
      return 0;
    }
  }

  subscribe(
    table: string,
    callback: (event: { upserts: any[]; deletes: string[] }) => void
  ): () => void {
    const colRef = collection(db, table);
    let isInitialSnapshot = true;

    const unsubscribe = onSnapshot(
      colRef,
      snapshot => {
        // We only push real-time changes to UI
        const upserts: any[] = [];
        const deletes: string[] = [];

        snapshot.docChanges().forEach(change => {
          const item = { id: change.doc.id, ...change.doc.data() };
          if (change.type === 'added' || change.type === 'modified') {
            upserts.push(item);
          } else if (change.type === 'removed') {
            deletes.push(change.doc.id);
          }
        });

        if (upserts.length > 0 || deletes.length > 0) {
          callback({ upserts, deletes });

          // If changes arrived from another device, show a helpful toast
          if (!isInitialSnapshot && (upserts.length > 0 || deletes.length > 0)) {
            if (typeof window !== 'undefined' && (window as any).__showPosNotification) {
              (window as any).__showPosNotification(
                `⚡ Realtime Sync: Data ${table} diperbarui otomatis dari Cloud`,
                'info'
              );
            }
          }
        }
        isInitialSnapshot = false;
      },
      error => {
        console.warn(`[Firestore] Realtime subscription error on '${table}':`, error);
      }
    );

    return unsubscribe;
  }
}

// Singleton Firestore Backend
let cloudBackendInstance: CloudBackend | null = null;

export function getFirestoreBackend(): CloudBackend {
  if (!cloudBackendInstance) {
    cloudBackendInstance = new FirestoreBackend();
  }
  return cloudBackendInstance;
}

// Expose globally so sandikale-bundle.js connects automatically
if (typeof window !== 'undefined') {
  (window as any).__getCloudBackend = () => Promise.resolve(getFirestoreBackend());
}
