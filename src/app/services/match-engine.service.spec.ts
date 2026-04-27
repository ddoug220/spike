import { MatchEngineService } from './match-engine.service';
import { MatchStateService } from './match-state.service';
import { MatchStatsService } from './match-stats.service';
import { OfflineSyncService } from './offline-sync.service';
import { RotationService } from './rotation.service';
import { FirebaseDbService } from './firebase-db.service';
import { TeamRosterService } from './team-roster.service';

describe('MatchEngineService', () => {
  let service: MatchEngineService;
  let matchState: MatchStateService;
  let teamRoster: TeamRosterService;
  let offlineSync: OfflineSyncService;

  beforeEach(() => {
    window.localStorage.clear();
    const firebaseDb = new FirebaseDbService();
    offlineSync = new OfflineSyncService(firebaseDb);
    matchState = new MatchStateService();
    const matchStats = new MatchStatsService();
    teamRoster = new TeamRosterService(new RotationService());
    service = new MatchEngineService(matchState, matchStats, teamRoster, offlineSync);
  });

  it('starts a new match with a new durable match id', () => {
    const first = offlineSync.getActiveMatchId();
    const second = service.startMatch('team');

    expect(second).not.toBe(first);
    expect(offlineSync.getActiveMatchId()).toBe(second);
    expect(matchState.state().teamPoints).toBe(0);
    expect(matchState.state().opponentPoints).toBe(0);
  });

  it('undoes lineup rotation when undoing a side-out scoring action', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    service.setServingTeam('opponent');
    service.recordPlayerAction(1, 'kill'); // side-out, rotates clockwise
    expect(teamRoster.lineup()[0]).toBe(players[1].id);

    service.undoLastEvent();
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('undos substitutions through the same undo stack', () => {
    for (let i = 1; i <= 7; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.slice(0, 6).forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    const didSubstitute = service.recordSubstitution(players[0].id, players[6].id);
    expect(didSubstitute).toBeTrue();
    expect(teamRoster.lineup()[0]).toBe(players[6].id);

    service.undoLastEvent();
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('records timeout calls and undoes them through the same undo stack', () => {
    const didCallTimeout = service.recordTimeout('team');
    expect(didCallTimeout).toBeTrue();
    expect(matchState.state().teamTimeoutsRemaining).toBe(1);

    service.undoLastEvent();
    expect(matchState.state().teamTimeoutsRemaining).toBe(2);
  });

  it('manually rotates lineup and supports undo through the same stack', () => {
    for (let i = 1; i <= 6; i += 1) {
      teamRoster.addPlayer({ name: `P${i}`, jerseyNumber: i, primaryPosition: 'OH' });
    }
    const players = teamRoster.players();
    players.forEach((player, index) => teamRoster.assignPlayerToPosition(player.id, index + 1));

    const didRotate = service.manualRotateTeam();
    expect(didRotate).toBeTrue();
    expect(matchState.state().teamRotation).toBe(2);
    expect(teamRoster.lineup()[0]).toBe(players[1].id);

    service.undoLastEvent();
    expect(matchState.state().teamRotation).toBe(1);
    expect(teamRoster.lineup()[0]).toBe(players[0].id);
  });

  it('blocks scoring events after match is ended', () => {
    service.startMatch('team');
    service.endMatch();
    const before = matchState.state();

    const event = service.recordPlayerAction(1, 'kill');
    const after = matchState.state();

    expect(event.impactedScore).toBeFalse();
    expect(event.impactedStats).toBeFalse();
    expect(after.teamPoints).toBe(before.teamPoints);
    expect(after.opponentPoints).toBe(before.opponentPoints);
  });
});
