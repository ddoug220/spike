import { MatchStateService } from './match-state.service';

describe('MatchStateService', () => {
  let service: MatchStateService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new MatchStateService();
  });

  it('tracks current rally score', () => {
    service.recordTeamPoint();
    service.recordOpponentPoint();
    service.recordTeamPoint();

    const state = service.state();
    expect(state.teamPoints).toBe(2);
    expect(state.opponentPoints).toBe(1);
    expect(state.teamSets).toBe(0);
    expect(state.opponentSets).toBe(0);
    expect(state.currentSet).toBe(1);
    expect(state.teamRotation).toBe(2);
    expect(state.teamTimeoutsRemaining).toBe(2);
    expect(state.opponentTimeoutsRemaining).toBe(2);
  });

  it('flags side-out when receiving team wins the rally', () => {
    service.setServingTeam('opponent');
    const result = service.recordTeamPoint(); // team wins while receiving

    expect(result.sideOut).toBeTrue();
    expect(service.state().servingTeam).toBe('team');
    expect(service.state().teamRotation).toBe(2);
  });

  it('tracks timeout usage and allows undo', () => {
    const didCallTimeout = service.callTimeout('team');
    expect(didCallTimeout).toBeTrue();
    expect(service.state().teamTimeoutsRemaining).toBe(1);

    service.undoLastPoint();
    expect(service.state().teamTimeoutsRemaining).toBe(2);
  });

  it('supports manual team rotation and undo', () => {
    const didRotate = service.rotateTeam();
    expect(didRotate).toBeTrue();
    expect(service.state().teamRotation).toBe(2);

    service.undoLastPoint();
    expect(service.state().teamRotation).toBe(1);
  });

  it('awards a set when target and two-point lead are met', () => {
    for (let i = 0; i < 25; i += 1) {
      service.recordTeamPoint();
    }

    const state = service.state();
    expect(state.teamSets).toBe(1);
    expect(state.opponentSets).toBe(0);
    expect(state.teamPoints).toBe(0);
    expect(state.opponentPoints).toBe(0);
    expect(state.currentSet).toBe(2);
  });

  it('requires a two-point lead to close a set', () => {
    for (let i = 0; i < 24; i += 1) {
      service.recordTeamPoint();
      service.recordOpponentPoint();
    }
    service.recordTeamPoint(); // 25-24

    let state = service.state();
    expect(state.teamSets).toBe(0);
    expect(state.teamPoints).toBe(25);
    expect(state.opponentPoints).toBe(24);

    service.recordTeamPoint(); // 26-24 closes
    state = service.state();
    expect(state.teamSets).toBe(1);
    expect(state.currentSet).toBe(2);
  });

  it('supports undoing the last point', () => {
    service.recordTeamPoint();
    service.recordOpponentPoint();
    service.undoLastPoint();

    const state = service.state();
    expect(state.teamPoints).toBe(1);
    expect(state.opponentPoints).toBe(0);
  });
});
