import { Provider, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import type { User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/firestore';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import type {
  FirestoreCollection,
  FirestoreDocumentMap,
  Game,
  GameEvent,
  PlayerSetStats,
} from './app/models/firestore.models';
import { AuthService } from './app/services/auth.service';
import { FirebaseDbService, FirebaseResult, TeamRosterSnapshot } from './app/services/firebase-db.service';

class E2eAuthService {
  private readonly testUser = { uid: 'e2e-user', email: 'coach@example.com', displayName: 'E2E Coach' } as User;
  readonly user = signal<User | null | undefined>(this.testUser).asReadonly();

  get uid(): string { return this.testUser.uid; }
  get email(): string | null { return this.testUser.email; }
  get displayName(): string | null { return this.testUser.displayName; }
  async signInWithGoogle(): Promise<void> {}
  async signInWithEmailPassword(): Promise<void> {}
  async createUserWithEmailPassword(): Promise<void> {}
  async signOut(): Promise<void> {}
}

class E2eFirebaseDbService {
  isConfigured(): boolean { return true; }

  async writeDocument<C extends FirestoreCollection>(
    _collectionName: C,
    documentId: string,
    _documentData: FirestoreDocumentMap[C],
  ): Promise<FirebaseResult<string>> {
    return { ok: true, data: documentId };
  }

  async writeEvent(event: GameEvent): Promise<FirebaseResult<string>> {
    return { ok: true, data: event.id };
  }

  async readDocument<C extends FirestoreCollection>(
    _collectionName: C,
    _documentId: string,
  ): Promise<FirebaseResult<FirestoreDocumentMap[C] | null>> {
    return { ok: true, data: null };
  }

  async readTeamRosterSnapshot(): Promise<FirebaseResult<TeamRosterSnapshot>> {
    return { ok: true, data: { teams: [], players: [], rosters: [] } };
  }

  subscribeGame(_gameId: string, onData: (game: Game | null) => void): Unsubscribe {
    onData(null);
    return () => undefined;
  }

  subscribeGames(_ownerId: string, onData: (games: Game[]) => void): Unsubscribe {
    onData([]);
    return () => undefined;
  }

  subscribeEvents(_gameId: string, onData: (events: GameEvent[]) => void): Unsubscribe {
    onData([]);
    return () => undefined;
  }

  subscribePlayerSetStats(_gameId: string, onData: (stats: PlayerSetStats[]) => void): Unsubscribe {
    onData([]);
    return () => undefined;
  }
}

const e2eProviders: Provider[] = [
  { provide: AuthService, useClass: E2eAuthService },
  { provide: FirebaseDbService, useClass: E2eFirebaseDbService },
];

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    ...e2eProviders,
  ],
});
