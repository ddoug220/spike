import { environment } from '../../environments/environment';
import { GameEvent } from '../models/firestore.models';
import { FirebaseDbService } from './firebase-db.service';

describe('FirebaseDbService', () => {
  let service: FirebaseDbService;
  let originalFirebase: typeof environment.firebase;

  beforeEach(() => {
    service = new FirebaseDbService();
    originalFirebase = { ...environment.firebase };
  });

  afterEach(() => {
    environment.firebase = { ...originalFirebase };
  });

  it('returns configuration status', () => {
    environment.firebase = {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
    };
    expect(service.isConfigured()).toBeFalse();

    environment.firebase = {
      apiKey: 'api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'project-id',
      storageBucket: 'example.appspot.com',
      messagingSenderId: 'sender-id',
      appId: 'app-id',
    };
    expect(service.isConfigured()).toBeTrue();
  });

  it('rejects writes when firebase is not configured', async () => {
    environment.firebase = {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
    };

    const event: GameEvent = {
      id: 'evt-1',
      gameId: 'game-1',
      type: 'matchStarted',
      action: 'match-started',
      servingTeam: 'team',
      createdAt: '2026-02-10T10:00:00.000Z',
      isDeleted: false,
    };

    const result = await service.createDocument('events', event);

    expect(result.ok).toBeFalse();
    expect(result.error).toContain('Firebase environment values');
  });
});
