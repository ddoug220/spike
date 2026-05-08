import { RotationService } from './rotation.service';
import { TeamRosterService } from './team-roster.service';
import type { BetaIdentityService } from './beta-identity.service';
import type { FirebaseDbService, TeamRosterSnapshot } from './firebase-db.service';
import type { OfflineSyncService } from './offline-sync.service';
import type { Player, Roster, Team } from '../models/firestore.models';

class FakeOfflineSyncService {
  readonly teams: Team[] = [];
  readonly players: Player[] = [];
  readonly rosters: Roster[] = [];

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

class FakeBetaIdentityService {
  readonly ownerId = 'owner-1';
}

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
    service = new TeamRosterService(new RotationService(), offlineSync as unknown as OfflineSyncService);

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
    service = new TeamRosterService(new RotationService(), offlineSync as unknown as OfflineSyncService);
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
      undefined,
      new FakeFirebaseDbService(snapshot) as unknown as FirebaseDbService,
      new FakeBetaIdentityService() as unknown as BetaIdentityService,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.team().name).toBe('Cloud High');
    expect(service.players().map((player) => player.name)).toEqual(['Ava Johnson']);
    expect(service.lineup()[0]).toBe('p-cloud-1');
  });
});
