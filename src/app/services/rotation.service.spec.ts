import { RotationService } from './rotation.service';

interface TestPlayer {
  id: number;
  name: string;
}

describe('RotationService', () => {
  let service: RotationService;
  const players: TestPlayer[] = [
    { id: 1, name: 'P1' },
    { id: 2, name: 'P2' },
    { id: 3, name: 'P3' },
    { id: 4, name: 'P4' },
    { id: 5, name: 'P5' },
    { id: 6, name: 'P6' },
  ];

  beforeEach(() => {
    service = new RotationService();
  });

  it('returns a copy when isSideOut is false', () => {
    const result = service.rotate(players, false);

    expect(result).toEqual(players);
    expect(result).not.toBe(players);
  });

  it('shifts players clockwise on side-out', () => {
    const result = service.rotate(players, true);

    expect(result.map((player) => player.id)).toEqual([2, 3, 4, 5, 6, 1]);
  });

  it('throws when array length is not 6', () => {
    expect(() => service.rotate(players.slice(0, 5), true)).toThrowError(
      /exactly 6 players/i,
    );
  });
});
