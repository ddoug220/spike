import { Component, Input, ViewEncapsulation } from '@angular/core';
import type { MatchPlayer } from '../../domain/match-v2';

@Component({
  selector: 'app-court-player',
  standalone: true,
  template: `
    <span class="court-player-meta">
      <strong>{{ player ? '#' + player.jerseyNumber : 'P' + position }}</strong>
      @if (player) { <span class="court-player-position">P{{ position }}</span> }
      @if (servingLabel) { <span class="server-label">{{ servingLabel }}</span> }
      @if (selected) { <span class="selection-check" aria-hidden="true">✓</span> }
    </span>
    <span class="court-player-name" dir="auto">{{ player?.name || emptyLabel }}</span>
    <ng-content />
  `,
})
export class CourtPlayerComponent {
  @Input() player: Pick<MatchPlayer, 'name' | 'jerseyNumber'> | null = null;
  @Input() position = 1;
  @Input() selected = false;
  @Input() servingLabel = '';
  @Input() emptyLabel = 'Open position';
}

@Component({
  selector: 'app-volleyball-court',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./volleyball-court.component.scss'],
  template: `
    <div class="volleyball-court" [class.compact]="variant === 'compact'" [class.responsive]="variant === 'responsive'">
      <span class="court-row-label front-label">Front row · Net</span>
      <span class="court-row-label back-label">Back row</span>
      <ng-content />
    </div>
  `,
})
export class VolleyballCourtComponent {
  @Input() variant: 'compact' | 'expanded' | 'responsive' = 'expanded';
}
