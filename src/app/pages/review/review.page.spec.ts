import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Game, GameEvent } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { ReviewPage } from './review.page';
import { MatchEngineService } from '../../services/match-engine.service';
import { ReviewInsightService } from '../../services/review-insight.service';

describe('ReviewPage', () => {
  let fixture: ComponentFixture<ReviewPage>;
  let emitCloudEvents: (events: GameEvent[]) => void;
  let writerConflictCount: number;
  let isCurrentScoringDevice: boolean;
  let activeMatchId: string;
  let localEvents: GameEvent[];
  let correctPlayerAttribution: jasmine.Spy;
  let prioritizeReviewInsights: jasmine.Spy;

  beforeEach(async () => {
    writerConflictCount = 0;
    isCurrentScoringDevice = true;
    activeMatchId = 'match-live';
    correctPlayerAttribution = jasmine.createSpy('correctPlayerAttribution').and.returnValue({ ok: true, value: 'correction' });
    prioritizeReviewInsights = jasmine.createSpy('prioritize').and.resolveTo([]);
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
    localEvents = [{
      id: 'start', ownerId: 'owner-1', gameId: 'match-live', type: 'matchStarted', action: 'match-started',
      eventKind: 'match-started', lineup: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], servingTeam: 'team',
      createdAt: '2026-02-10T10:00:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 1, writerGeneration: 1,
    }];
    const offlineSync = {
      getActiveMatchId: () => activeMatchId, getGame: () => game, getMatchSummaries: () => [],
      getMatchEvents: () => localEvents, getPlayerSetStats: () => [],
      isCurrentScoringDevice: () => isCurrentScoringDevice,
      cacheRemoteGame: () => undefined,
      cacheRemoteEvents: () => undefined,
      getWriterConflictCount: () => writerConflictCount,
      takeOverScoring: async () => false,
      mutationBlocked: () => false,
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
        { provide: MatchEngineService, useValue: { correctPlayerAttribution } },
        { provide: ReviewInsightService, useValue: { prioritize: prioritizeReviewInsights } },
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

  it('offers an append-only player correction only on the current scoring device', () => {
    localEvents.push({
      id: 'point', ownerId: 'owner-1', gameId: 'match-live', type: 'playerAction', action: 'kill',
      eventKind: 'rally-outcome', playerId: 'p1', rallyId: 'r1', servingTeamBefore: 'team', teamRotationBefore: 1,
      createdAt: '2026-02-10T10:01:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 2, writerGeneration: 1,
    });
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('.attribution-correction select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = 'p2';
    select.dispatchEvent(new Event('change'));
    expect(correctPlayerAttribution).toHaveBeenCalledWith('match-live', 'point', 'p2');

    isCurrentScoringDevice = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.attribution-correction')).toBeNull();
  });

  it('shows prioritized factual review cards returned by the insight service', async () => {
    localEvents[0] = { ...localEvents[0], servingTeam: 'opponent' };
    localEvents.push(
      {
        id: 'kill', ownerId: 'owner-1', gameId: 'match-live', type: 'playerAction', action: 'kill',
        eventKind: 'rally-outcome', playerId: 'p1', rallyId: 'r1', servingTeamBefore: 'opponent', teamRotationBefore: 1,
        createdAt: '2026-02-10T10:01:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 2, writerGeneration: 1,
      },
      {
        id: 'loss', ownerId: 'owner-1', gameId: 'match-live', type: 'opponentPoint', action: 'opponent-point',
        eventKind: 'rally-outcome', rallyId: 'r2', servingTeamBefore: 'team', teamRotationBefore: 2,
        createdAt: '2026-02-10T10:02:00.000Z', isDeleted: false, schemaVersion: 2, sequence: 3, writerGeneration: 1,
      },
    );
    prioritizeReviewInsights.and.callFake(async (_review: unknown, candidates: Array<{ id: string }>) =>
      candidates.map((candidate, index) => ({
        id: candidate.id,
        score: index === 0 ? 2.8 : 1.8,
        confidence: 0.8,
      })),
    );

    await fixture.componentInstance.refreshReviewInsights();
    fixture.detectChanges();

    const focus = fixture.nativeElement.querySelector('.review-focus').textContent;
    expect(prioritizeReviewInsights).toHaveBeenCalled();
    expect(focus).toContain('Review focus');
    expect(focus).toContain('side-out opportunities');
    expect(focus).toContain('event history');
  });
});
