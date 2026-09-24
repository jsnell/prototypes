import { describe, expect, it } from 'vitest';
import { AXIAL_DIRS, HexLayout, axialToOffset, directionTo, hexDistance, offsetToAxial, opposite, sdHexagon } from '../src/core/hex';

describe('hex coordinates', () => {
  it('round-trips offset and axial coordinates', () => {
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 9; row++) {
        const { q, r } = offsetToAxial(col, row);
        expect(axialToOffset(q, r)).toEqual({ col, row });
      }
    }
  });

  it('finds directions between neighbours and their opposites', () => {
    const a = { q: 3, r: 2 };
    AXIAL_DIRS.forEach(([dq, dr], d) => {
      const b = { q: a.q + dq, r: a.r + dr };
      expect(directionTo(a, b)).toBe(d);
      expect(directionTo(b, a)).toBe(opposite(d));
      expect(hexDistance(a, b)).toBe(1);
    });
  });

  it('maps hex centres back to the same hex', () => {
    const L = new HexLayout(30);
    for (let q = 0; q < 8; q++) {
      for (let r = -3; r < 6; r++) {
        expect(L.hexAt(L.centerX(q), L.centerY(q, r))).toEqual({ q, r });
      }
    }
  });
});

describe('sdHexagon', () => {
  const a = 10;
  const size = a / (Math.sqrt(3) / 2);
  it('is negative inside and zero on the boundary', () => {
    expect(sdHexagon(0, 0, a)).toBeCloseTo(-a);
    expect(sdHexagon(0, a, a)).toBeCloseTo(0);
    expect(sdHexagon(size, 0, a)).toBeCloseTo(0);
    expect(sdHexagon(0, a + 3, a)).toBeCloseTo(3);
  });
});
