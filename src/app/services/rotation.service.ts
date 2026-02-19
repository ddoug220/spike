import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class RotationService {
  rotate<T extends object>(players: T[], isSideOut: boolean): T[] {
    if (players.length !== 6) {
      throw new Error(`RotationService expects exactly 6 players, received ${players.length}.`);
    }

    if (!isSideOut) {
      return [...players];
    }

    return players.map((_, index) => players[(index + 1) % 6]);
  }
}
