import { Injectable } from '@angular/core';
import type { Game, GameEvent } from '../models/firestore.models';
import { reduceMatch, type MatchProjection } from '../domain/match-v2';
import type { MatchScoreState } from './match-state.service';
import type { StatsState } from './match-stats.service';
import {
  eventsFromFirestore,
  scoreStateFromProjection,
  sessionFromGame,
  statsStateFromProjection,
} from './match-v2.adapter';

@Injectable({ providedIn: 'root' })
export class MatchV2StoreService {
  projectionFor(game: Game, events: readonly GameEvent[]): MatchProjection | null {
    const session = sessionFromGame(game);
    return session ? reduceMatch(session, eventsFromFirestore(game, events)) : null;
  }

  scoreStateFrom(projection: MatchProjection): MatchScoreState {
    return scoreStateFromProjection(projection);
  }

  statsStateFrom(projection: MatchProjection): StatsState {
    return statsStateFromProjection(projection);
  }
}
