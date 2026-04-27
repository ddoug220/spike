import { Injectable } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  CollectionReference,
  DocumentData,
  Firestore,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import {
  FIRESTORE_COLLECTIONS,
  FirestoreCollection,
  FirestoreDocumentMap,
  GameEvent,
  PlayerSetStats,
} from '../models/firestore.models';

export interface FirebaseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class FirebaseDbService {
  private static readonly appName = 'spike-firebase';
  private static cachedApp: FirebaseApp | null = null;
  private static cachedDb: Firestore | null = null;
  private static cachedConfigKey = '';

  isConfigured(): boolean {
    const config = environment.firebase;
    return !!config.apiKey && !!config.projectId && !!config.appId;
  }

  async createDocument<C extends FirestoreCollection>(
    collectionName: C,
    documentData: FirestoreDocumentMap[C],
  ): Promise<FirebaseResult<string>> {
    return this.writeDocument(collectionName, documentData.id, documentData);
  }

  async writeDocument<C extends FirestoreCollection>(
    collectionName: C,
    documentId: string,
    documentData: FirestoreDocumentMap[C],
  ): Promise<FirebaseResult<string>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      await setDoc(doc(this.collectionRef(collectionName), documentId), documentData, { merge: true });
      return { ok: true, data: documentId };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore write failed.'),
      };
    }
  }

  async readDocument<C extends FirestoreCollection>(
    collectionName: C,
    documentId: string,
  ): Promise<FirebaseResult<FirestoreDocumentMap[C] | null>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      const snapshot = await getDoc(doc(this.collectionRef(collectionName), documentId));
      return { ok: true, data: snapshot.exists() ? snapshot.data() : null };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore read failed.'),
      };
    }
  }

  async readCollection<C extends FirestoreCollection>(
    collectionName: C,
  ): Promise<FirebaseResult<Array<FirestoreDocumentMap[C]>>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      const snapshot = await getDocs(this.collectionRef(collectionName));
      return { ok: true, data: snapshot.docs.map((entry) => entry.data()) };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore collection read failed.'),
      };
    }
  }

  async writeEvent(event: GameEvent): Promise<FirebaseResult<string>> {
    return this.writeDocument(FIRESTORE_COLLECTIONS.events, event.id, event);
  }

  async writePlayerSetStats(stats: PlayerSetStats): Promise<FirebaseResult<string>> {
    return this.writeDocument(FIRESTORE_COLLECTIONS.playerSetStats, stats.id, stats);
  }

  async readEvents(gameId: string): Promise<FirebaseResult<GameEvent[]>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      const snapshot = await getDocs(
        query(this.collectionRef('events'), where('gameId', '==', gameId), orderBy('createdAt', 'asc')),
      );
      return { ok: true, data: snapshot.docs.map((entry) => entry.data()) };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore event read failed.'),
      };
    }
  }

  async readPlayerSetStats(gameId: string): Promise<FirebaseResult<PlayerSetStats[]>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      const snapshot = await getDocs(
        query(
          this.collectionRef('playerSetStats'),
          where('gameId', '==', gameId),
          orderBy('jerseyNumber', 'asc'),
        ),
      );
      return { ok: true, data: snapshot.docs.map((entry) => entry.data()) };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore player stats read failed.'),
      };
    }
  }

  private collectionRef<C extends FirestoreCollection>(collectionName: C): CollectionReference<FirestoreDocumentMap[C]> {
    return collection(this.getDb(), collectionName).withConverter(this.converter<FirestoreDocumentMap[C]>());
  }

  private converter<T extends DocumentData>(): FirestoreDataConverter<T> {
    return {
      toFirestore: (value: WithFieldValue<T>): DocumentData => value as DocumentData,
      fromFirestore: (snapshot: QueryDocumentSnapshot, options: SnapshotOptions): T => snapshot.data(options) as T,
    };
  }

  private getDb(): Firestore {
    const config = environment.firebase;
    const configKey = [
      config.apiKey,
      config.authDomain,
      config.projectId,
      config.storageBucket,
      config.messagingSenderId,
      config.appId,
    ].join('|');

    if (!FirebaseDbService.cachedApp || !FirebaseDbService.cachedDb) {
      FirebaseDbService.cachedApp =
        getApps().find((app) => app.name === FirebaseDbService.appName) ??
        initializeApp(config, FirebaseDbService.appName);
      FirebaseDbService.cachedDb = getFirestore(FirebaseDbService.cachedApp);
      FirebaseDbService.cachedConfigKey = configKey;
    }

    return FirebaseDbService.cachedDb;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }
}
