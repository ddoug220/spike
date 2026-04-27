export type PrimaryPosition = 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';
export type TeamSide = 'team' | 'opponent';
export type GameStatus = 'scheduled' | 'live' | 'final';

export interface Team {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Game {
  id: string;
  teamId: string;
  opponentName: string;
  status: GameStatus;
  servingTeam: TeamSide;
  teamSets: number;
  opponentSets: number;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameSet {
  id: string;
  gameId: string;
  setNumber: number;
  teamPoints: number;
  opponentPoints: number;
  teamWon: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Roster {
  id: string;
  teamId: string;
  gameId: string | null;
  lineup: Array<string | null>;
  createdAt: string;
  updatedAt: string;
}

export type GameEventType =
  | 'matchStarted'
  | 'matchEnded'
  | 'serveTeamSet'
  | 'playerAction'
  | 'opponentPoint'
  | 'substitution'
  | 'timeoutCalled'
  | 'manualRotation'
  | 'undo';

export interface GameEvent {
  id: string;
  gameId: string;
  type: GameEventType;
  action: string;
  createdAt: string;
  playerId?: string | null;
  rotationPosition?: number;
  servingTeam?: TeamSide;
  lineup?: Array<string | null>;
  wasReceiving?: boolean;
  sideOutWon?: boolean;
  teamPoints?: number;
  opponentPoints?: number;
  teamSets?: number;
  opponentSets?: number;
  teamRotation?: number;
  outPlayerId?: string;
  inPlayerId?: string;
  timeoutTeam?: TeamSide;
  teamTimeoutsRemaining?: number;
  opponentTimeoutsRemaining?: number;
  targetEventId?: string;
}

export interface PlayerSetStats {
  id: string;
  gameId: string;
  playerId: string;
  playerName: string;
  jerseyNumber: number;
  setNumber: number | null;
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  hittingEfficiency: number | null;
  serveAttempts: number;
  serveInPercentage: number | null;
  sideOutPercentage: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreDocumentMap {
  teams: Team;
  players: Player;
  games: Game;
  sets: GameSet;
  roster: Roster;
  events: GameEvent;
  playerSetStats: PlayerSetStats;
}

export type FirestoreCollection = keyof FirestoreDocumentMap;
export type FirestoreDocument = FirestoreDocumentMap[FirestoreCollection];

export const FIRESTORE_COLLECTIONS: Record<FirestoreCollection, FirestoreCollection> = {
  teams: 'teams',
  players: 'players',
  games: 'games',
  sets: 'sets',
  roster: 'roster',
  events: 'events',
  playerSetStats: 'playerSetStats',
};
