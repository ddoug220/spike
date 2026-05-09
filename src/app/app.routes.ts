import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from './services/auth.service';
import { MatchStateService } from './services/match-state.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { TeamRosterService } from './services/team-roster.service';

const canActivateAuth: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return toObservable(auth.user).pipe(
    filter((user) => user !== undefined),
    take(1),
    map((user) => (user ? true : router.createUrlTree(['/login']))),
  );
};

const canActivateCourt: CanActivateFn = () => {
  const teamRoster = inject(TeamRosterService);
  const matchState = inject(MatchStateService);
  const offlineSync = inject(OfflineSyncService);
  const router = inject(Router);
  const lineup = teamRoster.lineup();
  const assigned = lineup.filter((playerId): playerId is string => !!playerId);
  const hasValidLineup =
    assigned.length === 6 &&
    new Set(assigned).size === 6 &&
    assigned.every((playerId) => !!teamRoster.getPlayerById(playerId));

  if (!hasValidLineup) {
    return router.createUrlTree(['/pre-match']);
  }

  const activeMatchId = offlineSync.getActiveMatchId();
  const hasStartedMatch =
    offlineSync.getMatchEvents(activeMatchId).some((event) => event.type === 'matchStarted') ||
    !!offlineSync.getGame(activeMatchId);
  const hasActiveMatch = hasStartedMatch && !matchState.state().isMatchOver;

  return hasActiveMatch ? true : router.createUrlTree(['/pre-match']);
};

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
    canActivate: [canActivateAuth],
  },
  {
    path: 'pre-match',
    loadComponent: () => import('./pages/pre-match/pre-match.page').then((m) => m.PreMatchPage),
    canActivate: [canActivateAuth],
  },
  {
    path: 'court',
    loadComponent: () => import('./pages/court/court.page').then((m) => m.CourtPage),
    canActivate: [canActivateAuth, canActivateCourt],
  },
  {
    path: 'history',
    loadComponent: () => import('./pages/history/history.page').then((m) => m.HistoryPage),
    canActivate: [canActivateAuth],
  },
];
