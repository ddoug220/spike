export const MATCH_SCHEMA_VERSION = 2 as const;

export type TeamSide = 'team' | 'opponent';
export type SetNumber = 1 | 2 | 3 | 4 | 5;
export type CourtPosition = 1 | 2 | 3 | 4 | 5 | 6;
export type TeamRotation = 1 | 2 | 3 | 4 | 5 | 6;
export type PlayerPosition = 'S' | 'OH' | 'MB' | 'OPP' | 'L' | 'DS';
export type Lineup = readonly [string, string, string, string, string, string];

export interface MatchPlayer {
  id: string;
  name: string;
  jerseyNumber: number;
  primaryPosition: PlayerPosition;
}

export interface MatchSession {
  schemaVersion: typeof MATCH_SCHEMA_VERSION;
  id: string;
  ownerId: string;
  teamId: string;
  opponentName: string;
  squad: readonly MatchPlayer[];
  createdAt: string;
}

interface MatchEventBase {
  schemaVersion: typeof MATCH_SCHEMA_VERSION;
  id: string;
  matchId: string;
  sequence: number;
  writerGeneration: number;
  occurredAt: string;
  setNumber?: SetNumber;
}

export interface MatchStartedEvent extends MatchEventBase {
  kind: 'match-started';
  lineup: Lineup;
  servingTeam: TeamSide;
}

export interface SetStartedEvent extends MatchEventBase {
  kind: 'set-started';
  setNumber: Exclude<SetNumber, 1>;
  lineup: Lineup;
  servingTeam: TeamSide;
}

export type PlayerRallyAction =
  | 'kill'
  | 'attack-error'
  | 'ace'
  | 'service-error'
  | 'receive-error'
  | 'block';
export type TeamRallyAction = 'opponent-error' | 'opponent-winner';
export type RallyAction = PlayerRallyAction | TeamRallyAction;

interface RallyOutcomeBase extends MatchEventBase {
  kind: 'rally-outcome';
  rallyId: string;
}

export type RallyOutcomeEvent =
  | (RallyOutcomeBase & { action: PlayerRallyAction; playerId: string })
  | (RallyOutcomeBase & { action: TeamRallyAction; playerId?: never });

export interface StatObservationEvent extends MatchEventBase {
  kind: 'stat-observation';
  rallyId: string;
  action: 'dig';
  playerId: string;
}

export interface SubstitutionEvent extends MatchEventBase {
  kind: 'substitution';
  position?: CourtPosition;
  outPlayerId: string;
  inPlayerId: string;
}

export interface TimeoutCalledEvent extends MatchEventBase {
  kind: 'timeout-called';
  team: TeamSide;
}

export interface ServeCorrectedEvent extends MatchEventBase {
  kind: 'serve-corrected';
  servingTeam: TeamSide;
}

export interface RotationCorrectedEvent extends MatchEventBase {
  kind: 'rotation-corrected';
  targetRotation: TeamRotation;
}

export interface MatchEndedEarlyEvent extends MatchEventBase {
  kind: 'match-ended-early';
}

export interface UndoEvent extends MatchEventBase {
  kind: 'undo';
  targetEventId: string;
}

export type MatchEvent =
  | MatchStartedEvent
  | SetStartedEvent
  | RallyOutcomeEvent
  | StatObservationEvent
  | SubstitutionEvent
  | TimeoutCalledEvent
  | ServeCorrectedEvent
  | RotationCorrectedEvent
  | MatchEndedEarlyEvent
  | UndoEvent;

export function rallyWinner(action: RallyAction): TeamSide {
  switch (action) {
    case 'kill':
    case 'ace':
    case 'block':
    case 'opponent-error':
      return 'team';
    case 'attack-error':
    case 'service-error':
    case 'receive-error':
    case 'opponent-winner':
      return 'opponent';
  }
}
