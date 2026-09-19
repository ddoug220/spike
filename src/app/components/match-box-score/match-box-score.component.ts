import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatchProjection, selectPlayerCountStats } from '../../domain/match-v2';

@Component({
  selector: 'app-match-box-score',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="stats-heading">
      <h2>Box score</h2>
      <label>Stats scope
        <select [ngModel]="selectedSet() ?? ''" (ngModelChange)="selectSet($event)">
          <option value="">Entire match</option>
          @for (set of match().submittedSets; track set.setNumber) {
            <option [value]="set.setNumber">Set {{ set.setNumber }}</option>
          }
        </select>
      </label>
    </div>
    <p>All Match Squad players. Court positions show the current lineup; totals follow each player through substitutions.</p>
    <div class="table-scroll" role="region" aria-label="Player box score" tabindex="0">
      <table>
        <caption>{{ selectedSet() ? 'Set ' + selectedSet() : 'Entire match' }} player totals</caption>
        <thead><tr>
          <th scope="col">Player</th><th scope="col">Position</th><th scope="col">Court</th>
          <th scope="col">Kills</th><th scope="col">Attack errors</th><th scope="col">Recorded attacks</th>
          <th scope="col">Aces</th><th scope="col">Blocks</th><th scope="col">Digs</th>
          <th scope="col">Service errors</th><th scope="col">Receive errors</th><th scope="col">Serves in / attempts</th><th scope="col">Serve in</th>
        </tr></thead>
        <tbody>
          @for (row of rows(); track row.playerId) {
            <tr>
              <th scope="row">#{{ row.player.jerseyNumber }} {{ row.player.name }}</th>
              <td>{{ row.player.primaryPosition }}</td><td>{{ row.courtPosition ? 'P' + row.courtPosition : 'Bench' }}</td>
              <td>{{ row.kills }}</td><td>{{ row.attackErrors }}</td><td>{{ row.totalAttacks }}</td>
              <td>{{ row.aces }}</td><td>{{ row.blocks }}</td><td>{{ row.digs }}</td>
              <td>{{ row.serviceErrors }}</td><td>{{ row.receiveErrors }}</td>
              <td>{{ row.servesIn }} / {{ row.serveAttempts }}</td><td>{{ rate(row.servesIn, row.serveAttempts) }}</td>
            </tr>
          }
        </tbody>
        <tfoot><tr>
          <th scope="row" colspan="3">Team total</th>
          <td>{{ totals().kills }}</td><td>{{ totals().attackErrors }}</td><td>{{ totals().totalAttacks }}</td>
          <td>{{ totals().aces }}</td><td>{{ totals().blocks }}</td><td>{{ totals().digs }}</td>
          <td>{{ totals().serviceErrors }}</td><td>{{ totals().receiveErrors }}</td>
          <td>{{ totals().servesIn }} / {{ totals().serveAttempts }}</td><td>{{ rate(totals().servesIn, totals().serveAttempts) }}</td>
        </tr></tfoot>
      </table>
    </div>
    <p class="stats-note">Recorded attacks count kills and attack errors only. Serve in uses completed rallies when your team served. A dash means no serve attempts were recorded.</p>
  `,
  styles: [`
    :host { display: block; min-width: 0; color: var(--color-text-1); }
    .stats-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
    h2 { margin: 0; font-family: var(--font-display); font-size: 1.4rem; text-transform: uppercase; }
    label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    select { min-height: 44px; padding: 8px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-2); color: inherit; font: inherit; }
    p { color: var(--color-text-2); line-height: 1.5; }
    .table-scroll { max-width: 100%; overflow-x: auto; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); }
    table { width: 100%; min-width: 1000px; border-collapse: collapse; font-variant-numeric: tabular-nums; background: var(--color-surface-1); }
    caption { padding: 12px; text-align: left; font-weight: 700; }
    th, td { min-width: 60px; padding: 12px; border-top: 1px solid var(--color-border); text-align: right; }
    thead th { background: var(--color-surface-2); font-size: .8rem; }
    th:first-child { position: sticky; left: 0; z-index: 1; min-width: 170px; max-width: 230px; overflow-wrap: anywhere; background: var(--color-surface-1); text-align: left; }
    tfoot { font-weight: 700; }
    .stats-note { font-size: .85rem; }
  `],
})
export class MatchBoxScoreComponent {
  readonly match = input.required<MatchProjection>();
  readonly selectedSet = signal<number | undefined>(undefined);
  readonly rows = computed(() => {
    const match = this.match();
    const stats = new Map(selectPlayerCountStats(match, this.selectedSet()).map((row) => [row.playerId, row]));
    return match.session.squad.map((player) => ({
      ...stats.get(player.id)!,
      player,
      courtPosition: (match.lineup?.indexOf(player.id) ?? -1) + 1,
    })).sort((left, right) => left.player.jerseyNumber - right.player.jerseyNumber || left.player.name.localeCompare(right.player.name));
  });
  readonly totals = computed(() => this.rows().reduce((total, row) => ({
    kills: total.kills + row.kills, attackErrors: total.attackErrors + row.attackErrors,
    totalAttacks: total.totalAttacks + row.totalAttacks, aces: total.aces + row.aces,
    blocks: total.blocks + row.blocks, digs: total.digs + row.digs,
    serviceErrors: total.serviceErrors + row.serviceErrors, receiveErrors: total.receiveErrors + row.receiveErrors,
    servesIn: total.servesIn + row.servesIn, serveAttempts: total.serveAttempts + row.serveAttempts,
  }), { kills: 0, attackErrors: 0, totalAttacks: 0, aces: 0, blocks: 0, digs: 0, serviceErrors: 0, receiveErrors: 0, servesIn: 0, serveAttempts: 0 }));

  selectSet(value: string): void {
    this.selectedSet.set(value === '' ? undefined : Number(value));
  }

  rate(servesIn: number, attempts: number): string {
    return attempts === 0 ? '–' : Math.round(servesIn / attempts * 100) + '%';
  }
}
