import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Game, GameEvent } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { ReviewPage } from './review.page';

describe('ReviewPage', () => {
  let fixture: ComponentFixture<ReviewPage>;
  let emitCloudEvents: (events: GameEvent[]) => void;
  let writerConflictCount: number;
  let isCurrentScoringDevice: boolean;
  let activeMatchId: string;

  beforeEach(async () => {
    writerConflictCount = 0;
    isCurrentScoringDevice = true;
    activeMatchId = 'match-live';
    const game: Game = {
      id: 'match-live', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 7, opponentPoints: 5, teamSets: 1, opponentSets: 0, currentSet: 2,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 3,
      startedAt: '2026-02-10T10:00:00.000Z', endedAt: null, createdAt: '2026-02-10T10:00:00.000Z',
      updatedAt: '2026-02-10T10:10:00.000Z',
      schemaVersion: 2,
      writerGeneration: 1,
      matchSquad: Array.from({ length: 6 }, (_, index) => ({
        id: `p${index + 1}`, name: `Player ${index + 1}`, jerseyNumber: index + 1, primaryPosition: 'OH',
      })),
      startingLineup: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
    };
    const offlineSync = {
      getActiveMatchId: () => activeMatchId, getGame: () => game, getMatchSummaries: () => [],
      getMatchEvents: () => [{
        id: 'start', ownerId: 'owner-1', gameId: 'match-live', type: 'matchStarted', action: 'match-started',
        eventKind: 'match-started', lineup: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], servingTeam: 'team',
        createdAt: '2026-02-10T10:00:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 1, writerGeneration: 1,
      }], getPlayerSetStats: () => [],
      isCurrentScoringDevice: () => isCurrentScoringDevice,
      cacheRemoteGame: () => undefined,
      cacheRemoteEvents: () => undefined,
      getWriterConflictCount: () => writerConflictCount,
      takeOverScoring: async () => false,
    };
    const firebaseDb = {
      subscribeGame: (_matchId: string, callback: (value: Game | null) => void) => {
        callback(game);
        return () => undefined;
      },
      subscribeEvents: (_matchId: string, callback: (value: unknown[]) => void) => {
        emitCloudEvents = callback as (events: GameEvent[]) => void;
        callback(offlineSync.getMatchEvents());
        return () => undefined;
      },
    };

    await TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [
        provideRouter([]),
        { provide: OfflineSyncService, useValue: offlineSync },
        { provide: FirebaseDbService, useValue: firebaseDb },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ matchId: 'match-live' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewPage);
    fixture.detectChanges();
  });

  it('shows factual live status and a resume action for the active match', () => {
    const text = fixture.nativeElement.textContent;
    const resume = fixture.nativeElement.querySelector('.resume-button') as HTMLAnchorElement;
    expect(text).toContain('Central High');
    expect(text).toContain('Live');
    expect(resume.getAttribute('href')).toBe('/court');
  });

  it('updates a live review when a cloud event arrives', () => {
    emitCloudEvents([
      {
        id: 'start', ownerId: 'owner-1', gameId: 'match-live', type: 'matchStarted', action: 'match-started',
        eventKind: 'match-started', lineup: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], servingTeam: 'team',
        createdAt: '2026-02-10T10:00:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 1, writerGeneration: 1,
      },
      {
        id: 'point', ownerId: 'owner-1', gameId: 'match-live', type: 'opponentPoint', action: 'opponent-point',
        eventKind: 'rally-outcome', createdAt: '2026-02-10T10:01:00.000Z', isDeleted: false,
        schemaVersion: 2, sequence: 2, writerGeneration: 1,
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Opponent winner');
  });

  it('shows quarantined stale-writer events as a sync conflict', () => {
    writerConflictCount = 2;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Scoring sync conflict');
    expect(fixture.nativeElement.textContent).toContain('2 events');
  });

  it('offers takeover for a remote live match that is not the local active match', () => {
    isCurrentScoringDevice = false;
    activeMatchId = 'different-local-match';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Take over scoring');
  });
});
