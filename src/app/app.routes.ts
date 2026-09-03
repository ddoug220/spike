import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthService } from './services/auth.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { projectionFromFirestore } from './services/match-v2.adapter';

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
  const offlineSync = inject(OfflineSyncService);
  const router = inject(Router);
  const activeMatchId = offlineSync.getActiveMatchId();
  const game = offlineSync.getGame(activeMatchId);
  const projection = game
    ? projectionFromFirestore(game, offlineSync.getMatchEvents(activeMatchId))
    : null;
  const lineup = projection?.lineup ?? [];
  const squadIds = new Set(projection?.session.squad.map((player) => player.id) ?? []);
  const hasValidLineup = lineup.length === 6 && new Set(lineup).size === 6 && lineup.every((id) => squadIds.has(id));
  const hasActiveMatch = hasValidLineup && (projection?.status === 'live' || projection?.status === 'set-break');

  if (!hasActiveMatch) {
    return router.createUrlTree(['/pre-match']);
  }

  return offlineSync.isCurrentScoringDevice(activeMatchId)
    ? true
    : router.createUrlTree(['/review', activeMatchId]);
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
    path: 'team',
    loadComponent: () => import('./pages/team/team.page').then((m) => m.TeamPage),
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
  {
    path: 'review/:matchId',
    loadComponent: () => import('./pages/review/review.page').then((m) => m.ReviewPage),
    canActivate: [canActivateAuth],
  },
];
