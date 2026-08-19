export type PrimaryPosition = 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';
export type TeamSide = 'team' | 'opponent';
export type GameStatus = 'scheduled' | 'live' | 'final' | 'ended-early';

export interface Team {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id: string;
  ownerId: string;
  teamId: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GameSquadPlayer {
  id: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PrimaryPosition;
}

export interface Game {
  id: string;
  ownerId: string;
  teamId: string;
  opponentName: string;
  status: GameStatus;
  servingTeam: TeamSide;
  teamPoints: number;
  opponentPoints: number;
  teamSets: number;
  opponentSets: number;
  currentSet: number;
  isMatchOver: boolean;
  isSetBreak?: boolean;
  teamTimeoutsRemaining: number;
  opponentTimeoutsRemaining: number;
  teamRotation: number;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion?: 2;
  writerDeviceId?: string;
  writerGeneration?: number;
  matchSquad?: GameSquadPlayer[];
  startingLineup?: Array<string | null>;
}

export interface GameSet {
  id: string;
  ownerId: string;
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
  ownerId: string;
  teamId: string;
  gameId: string | null;
  lineup: Array<string | null>;
  squadPlayerIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type GameEventType =
  | 'matchStarted'
  | 'setStarted'
  | 'matchEnded'
  | 'matchEndedEarly'
  | 'serveTeamSet'
  | 'playerAction'
  | 'opponentPoint'
  | 'substitution'
  | 'timeoutCalled'
  | 'manualRotation'
  | 'undo';

export interface GameEvent {
  id: string;
  ownerId: string;
  gameId: string;
  type: GameEventType;
  action: string;
  createdAt: string;
  isDeleted: boolean;
  deletedAt?: string | null;
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
  currentSet?: number;
  isMatchOver?: boolean;
  isSetBreak?: boolean;
  teamRotation?: number;
  teamTimeoutsRemaining?: number;
  opponentTimeoutsRemaining?: number;
  outPlayerId?: string;
  inPlayerId?: string;
  timeoutTeam?: TeamSide;
  targetEventId?: string;
  previousTeamRotation?: number;
  targetTeamRotation?: number;
  inferredServeInServerPlayerId?: string;
  actionSetNumber?: number;
  schemaVersion?: 2;
  sequence?: number;
  rallyId?: string;
  servingTeamBefore?: TeamSide;
  teamRotationBefore?: number;
  writerDeviceId?: string;
  writerGeneration?: number;
  eventKind?:
    | 'match-started'
    | 'set-started'
    | 'rally-outcome'
    | 'stat-observation'
    | 'substitution'
    | 'timeout-called'
    | 'serve-corrected'
    | 'rotation-corrected'
    | 'match-ended-early'
    | 'undo';
  courtPosition?: number;
  setNumber?: number;
  targetRotation?: number;
}

export interface PlayerSetStats {
  id: string;
  ownerId: string;
  gameId: string;
  playerId: string;
  playerName: string;
  jerseyNumber: number;
  setNumber: number | null;
  kills: number;
  attackErrors: number;
  totalAttacks: number;
  aces: number;
  serveAttempts: number;
  servesIn: number;
  serveInPercentage: number | null;
  blocks: number;
  digs: number;
  serviceErrors: number;
  receiveErrors: number;
  createdAt: string;
  updatedAt: string;
  writerDeviceId?: string;
  writerGeneration?: number;
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
