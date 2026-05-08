import { environment } from '../../environments/environment';
import { GameEvent, PlayerSetStats } from '../models/firestore.models';
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
      measurementId: '',
    };
    expect(service.isConfigured()).toBeFalse();

    environment.firebase = {
      apiKey: 'api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'project-id',
      storageBucket: 'example.appspot.com',
      messagingSenderId: 'sender-id',
      appId: 'app-id',
      measurementId: 'measurement-id',
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
      measurementId: '',
    };

    const event: GameEvent = {
      id: 'evt-1',
      ownerId: 'owner-1',
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

  it('sorts player set stats by jersey number after fetching Firestore rows', () => {
    const unsortedStats: PlayerSetStats[] = [
      playerSetStats({ id: 'stats-12', jerseyNumber: 12 }),
      playerSetStats({ id: 'stats-4', jerseyNumber: 4 }),
      playerSetStats({ id: 'stats-8', jerseyNumber: 8 }),
    ];

    const sortedStats = service['sortPlayerSetStats'](unsortedStats);

    expect(sortedStats.map((entry) => entry.jerseyNumber)).toEqual([4, 8, 12]);
    expect(unsortedStats.map((entry) => entry.jerseyNumber)).toEqual([12, 4, 8]);
  });
});

const playerSetStats = (overrides: Partial<PlayerSetStats> = {}): PlayerSetStats => ({
  id: 'stats-1',
  ownerId: 'owner-1',
  gameId: 'game-1',
  playerId: 'player-1',
  playerName: 'Ava Johnson',
  jerseyNumber: 1,
  setNumber: 1,
  kills: 0,
  attackErrors: 0,
  totalAttacks: 0,
  aces: 0,
  hittingEfficiency: null,
  serveAttempts: 0,
  servesIn: 0,
  serveInPercentage: null,
  blocks: 0,
  digs: 0,
  serviceErrors: 0,
  receiveErrors: 0,
  sideOutOpportunities: 0,
  sideOutConversions: 0,
  sideOutPercentage: null,
  createdAt: '2026-02-10T10:00:00.000Z',
  updatedAt: '2026-02-10T10:00:00.000Z',
  ...overrides,
});
