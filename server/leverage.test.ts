import { describe, expect, it } from 'vitest';
import { clampLeverage, leveragePresets, maxLeverageForCategory } from './leverage.js';

describe('leverage caps', () => {
  it('uses category maxima', () => {
    expect(maxLeverageForCategory('crypto')).toBe(10);
    expect(maxLeverageForCategory('forex')).toBe(50);
    expect(maxLeverageForCategory('indices')).toBe(30);
    expect(maxLeverageForCategory('index')).toBe(30);
    expect(maxLeverageForCategory('commodities')).toBe(20);
    expect(maxLeverageForCategory('commodity')).toBe(20);
    expect(maxLeverageForCategory('unknown')).toBe(10);
  });

  it('clamps requested leverage to the category cap', () => {
    expect(clampLeverage(100, 'forex')).toBe(50);
    expect(clampLeverage(50, 'crypto')).toBe(10);
    expect(clampLeverage(15, 'commodities')).toBe(15);
    expect(clampLeverage(Number.NaN, 'indices')).toBe(30);
    expect(clampLeverage(0, 'forex')).toBe(1);
  });

  it('exposes presets up to the cap', () => {
    expect(leveragePresets('crypto')).toEqual([2, 5, 10]);
    expect(leveragePresets('forex')).toEqual([10, 20, 30, 50]);
  });
});
