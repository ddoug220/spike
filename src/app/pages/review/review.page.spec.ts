import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Game } from '../../models/firestore.models';
import { OfflineSyncService } from '../../services/offline-sync.service';
import { ReviewPage } from './review.page';

describe('ReviewPage', () => {
  let fixture: ComponentFixture<ReviewPage>;

  beforeEach(async () => {
    const game: Game = {
      id: 'match-live', ownerId: 'owner-1', teamId: 'team-1', opponentName: 'Central High', status: 'live',
      servingTeam: 'team', teamPoints: 7, opponentPoints: 5, teamSets: 1, opponentSets: 0, currentSet: 2,
      isMatchOver: false, teamTimeoutsRemaining: 2, opponentTimeoutsRemaining: 2, teamRotation: 3,
      startedAt: '2026-02-10T10:00:00.000Z', endedAt: null, createdAt: '2026-02-10T10:00:00.000Z',
      updatedAt: '2026-02-10T10:10:00.000Z',
    };
    const offlineSync = {
      getActiveMatchId: () => 'match-live', getGame: () => game, getMatchSummaries: () => [],
      getMatchEvents: () => [], getPlayerSetStats: () => [],
      isCurrentScoringDevice: () => true,
      takeOverScoring: () => false,
    };

    await TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [
        provideRouter([]),
        { provide: OfflineSyncService, useValue: offlineSync },
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
});
