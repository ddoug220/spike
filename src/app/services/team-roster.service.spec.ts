import { RotationService } from './rotation.service';
import { TeamRosterService } from './team-roster.service';
import type { AuthService } from './auth.service';
import type { FirebaseDbService, TeamRosterSnapshot } from './firebase-db.service';
import type { OfflineSyncService } from './offline-sync.service';
import type { Player, Roster, Team } from '../models/firestore.models';

class FakeOfflineSyncService {
  readonly teams: Team[] = [];
  readonly players: Player[] = [];
  readonly rosters: Roster[] = [];

  saveLocalData(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }

  queueTeam(team: Team): void {
    this.teams.push(team);
  }

  queuePlayer(player: Player): void {
    this.players.push(player);
  }

  queueRoster(roster: Roster): void {
    this.rosters.push(roster);
  }
}

class FakeFirebaseDbService {
  constructor(private readonly snapshot: TeamRosterSnapshot | null) {}

  isConfigured(): boolean {
    return !!this.snapshot;
  }

  async readTeamRosterSnapshot(): Promise<{ ok: boolean; data?: TeamRosterSnapshot }> {
    return this.snapshot ? { ok: true, data: this.snapshot } : { ok: false };
  }
}

class FakeAuthService {
  readonly user = () => ({ uid: 'owner-1' });
  readonly uid = 'owner-1';
}

describe('TeamRosterService', () => {
  let service: TeamRosterService;

  beforeEach(() => {
    window.localStorage.clear();
    service = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService);
  });

  it('moves and swaps starters without removing squad members or roster players', () => {
    const first = service.addPlayer({ name: 'First', jerseyNumber: 1, primaryPosition: 'S' });
    const second = service.addPlayer({ name: 'Second', jerseyNumber: 2, primaryPosition: 'OH' });
    [first, second].forEach((player, index) => {
      service.setMatchSquadPlayer(player.id, true);
      service.assignMatchStarter(player.id, index + 1);
    });
    expect(service.moveMatchStarter(1, 3)).toBeTrue();
    expect(service.matchDefaults().startingLineup.slice(0, 3)).toEqual([null, second.id, first.id]);
    expect(service.moveMatchStarter(3, 2)).toBeTrue();
    expect(service.matchDefaults().startingLineup.slice(0, 3)).toEqual([null, first.id, second.id]);
    expect(service.getMatchSquadPlayers().map((player) => player.id)).toEqual([first.id, second.id]);
    service.unassignMatchStarter(2);
    expect(service.players().length).toBe(2);
    expect(service.getMatchSquadPlayers().length).toBe(2);
    expect(service.moveMatchStarter(1, 2)).toBeFalse();
    expect(service.moveMatchStarter(3, 7)).toBeFalse();
  });

  it('creates a persistent team profile for the saved player pool', () => {
    const initialTeam = service.team();

    expect(initialTeam.id).toMatch(/^team-/);
    expect(initialTeam.name).toBe('My Team');

    const didUpdate = service.updateTeamName('  Falcons  ');

    expect(didUpdate).toBeTrue();
    expect(service.team().id).toBe(initialTeam.id);
    expect(service.team().name).toBe('Falcons');

    const restored = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService);
    expect(restored.team()).toEqual(service.team());
  });

  it('restores legacy roster data that does not have a team profile', () => {
    window.localStorage.setItem(
      'spike-volleyball-roster-v1:owner-1',
      JSON.stringify({
        players: [{ id: 'p-1', name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' }],
        lineup: ['p-1', null, null, null, null, null],
      }),
    );

    const restored = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService);

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
    expect(service.getPlayerById(players[0].id)).toEqual(
      jasmine.objectContaining({
        id: players[0].id,
        name: 'Updated Player',
        jerseyNumber: 42,
        primaryPosition: 'L',
        active: true,
        createdAt: players[0].createdAt,
      }),
    );
  });

  it('queues team, players, and roster documents for Firebase sync', () => {
    const offlineSync = new FakeOfflineSyncService();
    service = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService, offlineSync as unknown as OfflineSyncService);

    service.updateTeamName('North High');
    service.addPlayer({ name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' });
    const player = service.players()[0];
    service.assignPlayerToPosition(player.id, 1);

    expect(offlineSync.teams[offlineSync.teams.length - 1]).toEqual({
      id: service.team().id,
      ownerId: jasmine.any(String),
      name: 'North High',
      createdAt: service.team().createdAt,
      updatedAt: service.team().updatedAt,
    });
    expect(offlineSync.players[offlineSync.players.length - 1]).toEqual({
      id: player.id,
      ownerId: jasmine.any(String),
      teamId: service.team().id,
      name: 'Ava Johnson',
      jerseyNumber: 4,
      primaryPosition: 'OH',
      active: true,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    });
    expect(offlineSync.rosters[offlineSync.rosters.length - 1]).toEqual(
      jasmine.objectContaining({
        id: `${service.team().id}-active-roster`,
        teamId: service.team().id,
        gameId: null,
        lineup: [player.id, null, null, null, null, null],
      }),
    );
  });

  it('marks removed players inactive in Firebase', () => {
    const offlineSync = new FakeOfflineSyncService();
    service = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService, offlineSync as unknown as OfflineSyncService);
    service.addPlayer({ name: 'Ava Johnson', jerseyNumber: 4, primaryPosition: 'OH' });
    const player = service.players()[0];

    service.removePlayer(player.id);

    expect(offlineSync.players[offlineSync.players.length - 1]).toEqual(
      jasmine.objectContaining({
        id: player.id,
        teamId: service.team().id,
        active: false,
      }),
    );
  });

  it('restores team, players, and active roster from Firebase on a fresh device', async () => {
    const snapshot: TeamRosterSnapshot = {
      teams: [
        {
          id: 'team-cloud',
          ownerId: 'owner-1',
          name: 'Cloud High',
          createdAt: '2026-02-10T10:00:00.000Z',
          updatedAt: '2026-02-10T10:05:00.000Z',
        },
      ],
      players: [
        {
          id: 'p-cloud-1',
          ownerId: 'owner-1',
          teamId: 'team-cloud',
          name: 'Ava Johnson',
          jerseyNumber: 4,
          primaryPosition: 'OH',
          active: true,
          createdAt: '2026-02-10T10:01:00.000Z',
          updatedAt: '2026-02-10T10:01:00.000Z',
        },
        {
          id: 'p-cloud-2',
          ownerId: 'owner-1',
          teamId: 'team-cloud',
          name: 'Inactive Player',
          jerseyNumber: 99,
          primaryPosition: 'DS',
          active: false,
          createdAt: '2026-02-10T10:01:00.000Z',
          updatedAt: '2026-02-10T10:02:00.000Z',
        },
      ],
      rosters: [
        {
          id: 'team-cloud-active-roster',
          ownerId: 'owner-1',
          teamId: 'team-cloud',
          gameId: null,
          lineup: ['p-cloud-1', null, null, null, null, null],
          createdAt: '2026-02-10T10:00:00.000Z',
          updatedAt: '2026-02-10T10:05:00.000Z',
        },
      ],
    };

    service = new TeamRosterService(
      new RotationService(),
      new FakeAuthService() as unknown as AuthService,
      undefined,
      new FakeFirebaseDbService(snapshot) as unknown as FirebaseDbService,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.team().name).toBe('Cloud High');
    expect(service.players().map((player) => player.name)).toEqual(['Ava Johnson']);
    expect(service.lineup()[0]).toBe('p-cloud-1');

    service.updatePlayer('p-cloud-1', { name: 'Ava Updated', jerseyNumber: 14, primaryPosition: 'S' });
    const otherTeam = { ...snapshot.teams[0], id: 'team-other', name: 'Other High', updatedAt: '2026-02-09T10:00:00.000Z' };
    snapshot.teams.push(otherTeam);
    snapshot.players.push({ ...snapshot.players[0], id: 'p-other', teamId: otherTeam.id, name: 'Other Player' });
    // Reload the stale cloud snapshot; saved player edits must survive it.
    service = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService, undefined, new FakeFirebaseDbService(snapshot) as unknown as FirebaseDbService);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.players()[0].name).toBe('Ava Updated');
    expect(service.cloudTeams().length).toBe(2);

    const restarted = new TeamRosterService(new RotationService(), new FakeAuthService() as unknown as AuthService);
    expect(restarted.switchToTeam(otherTeam.id)).toBeTrue();
    expect(restarted.players()[0].name).toBe('Other Player');
    expect(restarted.lineup()).toEqual([null, null, null, null, null, null]);
    expect(restarted.switchToTeam('team-cloud')).toBeTrue();
    expect(restarted.players()[0].name).toBe('Ava Updated');
    restarted.clearOwnerLocalData();
    expect(restarted.cloudTeams()).toEqual([]);
    expect(restarted.matchDefaults().squadPlayerIds).toEqual([]);
  });
});
