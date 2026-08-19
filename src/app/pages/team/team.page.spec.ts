import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FirebaseDbService } from '../../services/firebase-db.service';
import { TeamRosterService } from '../../services/team-roster.service';
import { TeamPage } from './team.page';

describe('TeamPage', () => {
  let component: TeamPage;
  let fixture: ComponentFixture<TeamPage>;
  let teamRoster: TeamRosterService;

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FirebaseDbService, useValue: { isConfigured: () => false } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamPage);
    component = fixture.componentInstance;
    teamRoster = TestBed.inject(TeamRosterService);
    fixture.detectChanges();
  });

  it('manages saved team and player data without match lineup controls', () => {
    component.teamNameDraft = 'North High';
    component.saveTeam();
    component.draft = { name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' };
    component.submitPlayer();
    fixture.detectChanges();

    expect(teamRoster.team().name).toBe('North High');
    expect(teamRoster.players()[0]).toEqual(jasmine.objectContaining({ name: 'Ava Johnson', jerseyNumber: 4 }));
    expect(fixture.nativeElement.textContent).toContain('Saved Players');
    expect(fixture.nativeElement.textContent).not.toContain('Starting Six');
  });
});
