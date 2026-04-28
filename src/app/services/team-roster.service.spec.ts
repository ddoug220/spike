import { RotationService } from './rotation.service';
import { TeamRosterService } from './team-roster.service';

describe('TeamRosterService', () => {
  let service: TeamRosterService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new TeamRosterService(new RotationService());
  });

  it('creates a persistent team profile for the saved player pool', () => {
    const initialTeam = service.team();

    expect(initialTeam.id).toMatch(/^team-/);
    expect(initialTeam.name).toBe('My Team');

    const didUpdate = service.updateTeamName('  Falcons  ');

    expect(didUpdate).toBeTrue();
    expect(service.team().id).toBe(initialTeam.id);
    expect(service.team().name).toBe('Falcons');

    const restored = new TeamRosterService(new RotationService());
    expect(restored.team()).toEqual(service.team());
  });

  it('restores legacy roster data that does not have a team profile', () => {
    window.localStorage.setItem(
      'spike-volleyball-roster-v1',
      JSON.stringify({
        players: [{ id: 'p-1', name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' }],
        lineup: ['p-1', null, null, null, null, null],
      }),
    );

    const restored = new TeamRosterService(new RotationService());

    expect(restored.team().name).toBe('My Team');
    expect(restored.players()[0].name).toBe('Ava Johnson');
    expect(restored.lineup()[0]).toBe('p-1');
  });

  it('rotates lineup clockwise for side-out behavior', () => {
    for (let i = 1; i <= 6; i += 1) {
      service.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }

    const players = service.players();
    players.forEach((player, index) => service.assignPlayerToPosition(player.id, index + 1));

    service.rotateLineupClockwise();

    const rotatedIds = service.lineup();
    expect(rotatedIds[0]).toBe(players[1].id);
    expect(rotatedIds[1]).toBe(players[2].id);
    expect(rotatedIds[2]).toBe(players[3].id);
    expect(rotatedIds[3]).toBe(players[4].id);
    expect(rotatedIds[4]).toBe(players[5].id);
    expect(rotatedIds[5]).toBe(players[0].id);
  });

  it('substitutes a bench player for an on-court player', () => {
    for (let i = 1; i <= 7; i += 1) {
      service.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const players = service.players();
    players.slice(0, 6).forEach((player, index) => service.assignPlayerToPosition(player.id, index + 1));

    const didSubstitute = service.substitutePlayers(players[0].id, players[6].id);

    expect(didSubstitute).toBeTrue();
    expect(service.lineup()[0]).toBe(players[6].id);
    expect(service.isAssigned(players[0].id)).toBeFalse();
  });

  it('rejects substitution when incoming player is already on court', () => {
    for (let i = 1; i <= 6; i += 1) {
      service.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }
    const players = service.players();
    players.forEach((player, index) => service.assignPlayerToPosition(player.id, index + 1));

    const didSubstitute = service.substitutePlayers(players[0].id, players[1].id);

    expect(didSubstitute).toBeFalse();
    expect(service.lineup()[0]).toBe(players[0].id);
  });

  it('updates player details without changing lineup assignment', () => {
    for (let i = 1; i <= 6; i += 1) {
      service.addPlayer({
        name: `Player ${i}`,
        jerseyNumber: i,
        primaryPosition: 'OH',
      });
    }

    const players = service.players();
    service.assignPlayerToPosition(players[0].id, 1);

    const didUpdate = service.updatePlayer(players[0].id, {
      name: 'Updated Player',
      jerseyNumber: 42,
      primaryPosition: 'L',
    });

    expect(didUpdate).toBeTrue();
    expect(service.lineup()[0]).toBe(players[0].id);
    expect(service.getPlayerById(players[0].id)).toEqual({
      ...players[0],
      name: 'Updated Player',
      jerseyNumber: 42,
      primaryPosition: 'L',
    });
  });
});
