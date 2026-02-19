import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { TeamRosterService } from './services/team-roster.service';

const canActivateCourt: CanActivateFn = () => {
  const teamRoster = inject(TeamRosterService);
  const router = inject(Router);
  const lineup = teamRoster.lineup();
  const assigned = lineup.filter((playerId): playerId is string => !!playerId);
  const hasValidLineup =
    assigned.length === 6 &&
    new Set(assigned).size === 6 &&
    assigned.every((playerId) => !!teamRoster.getPlayerById(playerId));

  return hasValidLineup ? true : router.createUrlTree(['/pre-match']);
};

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pre-match',
    pathMatch: 'full',
  },
  {
    path: 'pre-match',
    loadComponent: () => import('./pages/pre-match/pre-match.page').then((m) => m.PreMatchPage),
  },
  {
    path: 'court',
    loadComponent: () => import('./pages/court/court.page').then((m) => m.CourtPage),
    canActivate: [canActivateCourt],
  },
  {
    path: 'history',
    loadComponent: () => import('./pages/history/history.page').then((m) => m.HistoryPage),
  },
];
