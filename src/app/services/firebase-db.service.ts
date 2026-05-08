import { Injectable } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  CollectionReference,
  DocumentData,
  Firestore,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  Unsubscribe,
  WithFieldValue,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  onSnapshot,
  setDoc,
  where,
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import {
  FIRESTORE_COLLECTIONS,
  FirestoreCollection,
  FirestoreDocumentMap,
  Game,
  GameEvent,
  Player,
  PlayerSetStats,
  Roster,
  Team,
} from '../models/firestore.models';

export interface FirebaseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TeamRosterSnapshot {
  teams: Team[];
  players: Player[];
  rosters: Roster[];
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

  async readTeamRosterSnapshot(ownerId: string): Promise<FirebaseResult<TeamRosterSnapshot>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      const [teams, players, rosters] = await Promise.all([
        this.readOwnedCollection('teams', ownerId),
        this.readOwnedCollection('players', ownerId),
        this.readOwnedCollection('roster', ownerId),
      ]);

      return {
        ok: true,
        data: {
          teams,
          players,
          rosters,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore roster read failed.'),
      };
    }
  }

  async writeEvent(event: GameEvent): Promise<FirebaseResult<string>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      await setDoc(doc(this.gameEventsRef(event.gameId), event.id), event, { merge: true });
      return { ok: true, data: event.id };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore event write failed.'),
      };
    }
  }

  async markEventDeleted(gameId: string, eventId: string, deletedAt: string): Promise<FirebaseResult<string>> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: 'Firebase environment values are not configured.',
      };
    }

    try {
      await setDoc(
        doc(this.gameEventsRef(gameId), eventId),
        {
          isDeleted: true,
          deletedAt,
        },
        { merge: true },
      );
      return { ok: true, data: eventId };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore event delete marker write failed.'),
      };
    }
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
        query(this.gameEventsRef(gameId), orderBy('createdAt', 'asc')),
      );
      return { ok: true, data: snapshot.docs.map((entry) => entry.data()).filter((event) => !event.isDeleted) };
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
        ),
      );
      return { ok: true, data: this.sortPlayerSetStats(snapshot.docs.map((entry) => entry.data())) };
    } catch (error) {
      return {
        ok: false,
        error: this.toErrorMessage(error, 'Firestore player stats read failed.'),
      };
    }
  }

  subscribeGame(gameId: string, onData: (game: Game | null) => void): Unsubscribe {
    if (!this.isConfigured()) {
      onData(null);
      return () => undefined;
    }

    return onSnapshot(doc(this.collectionRef('games'), gameId), (snapshot) => {
      onData(snapshot.exists() ? snapshot.data() : null);
    });
  }

  subscribeEvents(gameId: string, onData: (events: GameEvent[]) => void): Unsubscribe {
    if (!this.isConfigured()) {
      onData([]);
      return () => undefined;
    }

    return onSnapshot(query(this.gameEventsRef(gameId), orderBy('createdAt', 'asc')), (snapshot) => {
      onData(snapshot.docs.map((entry) => entry.data()).filter((event) => !event.isDeleted));
    });
  }

  subscribePlayerSetStats(gameId: string, onData: (stats: PlayerSetStats[]) => void): Unsubscribe {
    if (!this.isConfigured()) {
      onData([]);
      return () => undefined;
    }

    return onSnapshot(
      query(this.collectionRef('playerSetStats'), where('gameId', '==', gameId)),
      (snapshot) => {
        onData(this.sortPlayerSetStats(snapshot.docs.map((entry) => entry.data())));
      },
    );
  }

  private sortPlayerSetStats(stats: PlayerSetStats[]): PlayerSetStats[] {
    return [...stats].sort((a, b) => a.jerseyNumber - b.jerseyNumber);
  }

  private collectionRef<C extends FirestoreCollection>(collectionName: C): CollectionReference<FirestoreDocumentMap[C]> {
    return collection(this.getDb(), collectionName).withConverter(this.converter<FirestoreDocumentMap[C]>());
  }

  private async readOwnedCollection<C extends 'teams' | 'players' | 'roster'>(
    collectionName: C,
    ownerId: string,
  ): Promise<Array<FirestoreDocumentMap[C]>> {
    const snapshot = await getDocs(query(this.collectionRef(collectionName), where('ownerId', '==', ownerId)));
    return snapshot.docs.map((entry) => entry.data());
  }

  private gameEventsRef(gameId: string): CollectionReference<GameEvent> {
    return collection(doc(this.collectionRef(FIRESTORE_COLLECTIONS.games), gameId), FIRESTORE_COLLECTIONS.events).withConverter(
      this.converter<GameEvent>(),
    );
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
