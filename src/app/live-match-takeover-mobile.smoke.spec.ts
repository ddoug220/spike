import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Game, GameEvent, Player, Roster, Team } from './models/firestore.models';
import { CourtPage } from './pages/court/court.page';
import { ReviewPage } from './pages/review/review.page';
import { AuthService } from './services/auth.service';
import { FirebaseDbService } from './services/firebase-db.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { TeamRosterService } from './services/team-roster.service';

const ownerId = 'takeover-owner';
const matchId = 'remote-live-match';
const startedAt = '2026-08-24T18:00:00.000Z';
const players = Array.from({ length: 7 }, (_, index): Player => ({
  id: `p${index + 1}`,
  ownerId,
  teamId: 'team-1',
  name: `Player ${index + 1}`,
  jerseyNumber: index + 1,
  primaryPosition: 'OH',
  active: true,
  createdAt: startedAt,
  updatedAt: startedAt,
}));
const initialLineup = players.slice(0, 6).map((player) => player.id);

class FakeAuthService {
  private readonly userSignal = signal<{ uid: string; email: string } | null | undefined>({
    uid: ownerId,
    email: 'coach@example.com',
  });

  readonly user = this.userSignal.asReadonly();
  readonly uid = ownerId;
}

class TakeoverFirebaseDbService {
  game: Game = {
    id: matchId,
    ownerId,
    teamId: 'team-1',
    opponentName: 'Central High',
    status: 'live',
    servingTeam: 'team',
    teamPoints: 2,
    opponentPoints: 1,
    teamSets: 0,
    opponentSets: 0,
    currentSet: 1,
    isMatchOver: false,
    teamTimeoutsRemaining: 2,
    opponentTimeoutsRemaining: 2,
    teamRotation: 2,
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    updatedAt: '2026-08-24T18:06:00.000Z',
    schemaVersion: 2,
    writerDeviceId: 'other-scoring-device',
    writerGeneration: 4,
    matchSquad: players.map(({ id, name, jerseyNumber, primaryPosition }) => ({
      id,
      name,
      jerseyNumber,
      primaryPosition,
    })),
    startingLineup: initialLineup,
  };

  readonly events: GameEvent[] = [
    this.event('start', 1, 'matchStarted', 'match-started', 'match-started', {
      lineup: initialLineup,
      servingTeam: 'team',
    }),
    this.event('p1-kill', 2, 'playerAction', 'kill', 'rally-outcome', {
      playerId: 'p1', rallyId: 'rally-1', servingTeamBefore: 'team', teamRotationBefore: 1,
    }),
    this.event('opponent-point', 3, 'opponentPoint', 'opponent-point', 'rally-outcome', {
      rallyId: 'rally-2', servingTeamBefore: 'team', teamRotationBefore: 1,
    }),
    this.event('substitution', 4, 'substitution', 'substitution', 'substitution', {
      outPlayerId: 'p2', inPlayerId: 'p7', courtPosition: 2,
    }),
    this.event('p7-side-out-kill', 5, 'playerAction', 'kill', 'rally-outcome', {
      playerId: 'p7', rallyId: 'rally-3', servingTeamBefore: 'opponent', teamRotationBefore: 1,
    }),
  ];

  private gameSubscribers: Array<(game: Game | null) => void> = [];
  private eventSubscribers: Array<(events: GameEvent[]) => void> = [];

  isConfigured(): boolean {
    return true;
  }

  async readTeamRosterSnapshot(): Promise<{ ok: true; data: { teams: Team[]; players: Player[]; rosters: Roster[] } }> {
    return {
      ok: true,
      data: {
        teams: [{ id: 'team-1', ownerId, name: 'West Ridge', createdAt: startedAt, updatedAt: startedAt }],
        players,
        rosters: [{
          id: 'team-1-active-roster', ownerId, teamId: 'team-1', gameId: null,
          lineup: initialLineup, squadPlayerIds: players.map((player) => player.id),
          createdAt: startedAt, updatedAt: startedAt,
        }],
      },
    };
  }

  subscribeGame(_gameId: string, onData: (game: Game | null) => void): () => void {
    this.gameSubscribers.push(onData);
    onData(this.game);
    return () => { this.gameSubscribers = this.gameSubscribers.filter((subscriber) => subscriber !== onData); };
  }

  subscribeEvents(_gameId: string, onData: (events: GameEvent[]) => void): () => void {
    this.eventSubscribers.push(onData);
    onData([...this.events]);
    return () => { this.eventSubscribers = this.eventSubscribers.filter((subscriber) => subscriber !== onData); };
  }

  subscribePlayerSetStats(_gameId: string, onData: (stats: []) => void): () => void {
    onData([]);
    return () => undefined;
  }

  async readDocument(collection: string, documentId: string): Promise<{ ok: true; data: Game | null }> {
    return { ok: true, data: collection === 'games' && documentId === matchId ? this.game : null };
  }

  async writeDocument(collection: string, _documentId: string, payload: Game): Promise<{ ok: true; data: string }> {
    if (collection === 'games') {
      this.game = payload;
      this.gameSubscribers.forEach((subscriber) => subscriber(this.game));
    }
    return { ok: true, data: payload.id };
  }

  async writeEvent(event: GameEvent): Promise<{ ok: true; data: string }> {
    this.events.push(event);
    this.eventSubscribers.forEach((subscriber) => subscriber([...this.events]));
    return { ok: true, data: event.id };
  }

  private event(
    id: string,
    sequence: number,
    type: GameEvent['type'],
    action: string,
    eventKind: GameEvent['eventKind'],
    patch: Partial<GameEvent>,
  ): GameEvent {
    return {
      id,
      ownerId,
      gameId: matchId,
      type,
      action,
      eventKind,
      createdAt: `2026-08-24T18:0${sequence}:00.000Z`,
      isDeleted: false,
      schemaVersion: 2,
      sequence,
      writerDeviceId: 'other-scoring-device',
      writerGeneration: 4,
      setNumber: 1,
      ...patch,
    };
  }
}

describe('Live-match takeover recovery on a small phone', () => {
  let restoreViewport: () => void;
  let firebaseDb: TakeoverFirebaseDbService;

  beforeEach(async () => {
    window.localStorage.clear();
    restoreViewport = setSmallPhoneViewport();
    spyOnProperty(window.navigator, 'onLine', 'get').and.returnValue(true);
    firebaseDb = new TakeoverFirebaseDbService();

    await TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AuthService, useClass: FakeAuthService },
        { provide: FirebaseDbService, useValue: firebaseDb },
      ],
    }).compileComponents();

    TestBed.inject(TeamRosterService);
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    restoreViewport();
  });

  it('recovers the canonical court state after takeover and continues scoring', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    expect(window.innerWidth).toBe(375);

    await harness.navigateByUrl(`/review/${matchId}`, ReviewPage);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const takeover = harness.routeNativeElement?.querySelector('.resume-button') as HTMLButtonElement;
    expect(takeover.textContent).toContain('Take over scoring');
    takeover.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/court');
    const court = harness.routeDebugElement?.componentInstance as CourtPage;
    expect(court.gameState.teamPoints).toBe(2);
    expect(court.gameState.opponentPoints).toBe(1);
    expect(court.gameState.teamRotation).toBe(2);
    expect(court.getPlayerForPosition(1)?.id).toBe('p7');
    expect(court.getPlayerForPosition(6)?.id).toBe('p1');
    expect(court.getPlayerTileStatLine(1)).toBe('1K / 0E');
    expect(court.getPlayerTileStatLine(6)).toBe('1K / 0E');

    const positionOneTile = harness.routeNativeElement?.querySelector('[data-position="1"]') as HTMLButtonElement;
    const kill = harness.routeNativeElement?.querySelector('[aria-label="Kill - awards point"]') as HTMLButtonElement;
    positionOneTile.click();
    kill.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(court.gameState.teamPoints).toBe(3);
    expect(court.gameState.opponentPoints).toBe(1);
    expect(court.getPlayerTileStatLine(1)).toBe('2K / 0E');
    const recoveredEvents = TestBed.inject(OfflineSyncService).getMatchEvents(matchId);
    const appended = recoveredEvents[recoveredEvents.length - 1];
    expect(appended).toEqual(jasmine.objectContaining({
      action: 'kill',
      playerId: 'p7',
      writerGeneration: 5,
    }));
  });
});

function setSmallPhoneViewport(): () => void {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  const widthSpy = spyOnProperty(window, 'innerWidth', 'get').and.returnValue(375);
  const heightSpy = spyOnProperty(window, 'innerHeight', 'get').and.returnValue(667);
  window.dispatchEvent(new Event('resize'));

  return () => {
    widthSpy.and.returnValue(originalWidth);
    heightSpy.and.returnValue(originalHeight);
    window.dispatchEvent(new Event('resize'));
  };
}
