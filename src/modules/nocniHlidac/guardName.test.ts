import { describe, expect, it } from 'vitest';
import { guardName } from './guardName.js';

describe('guardName', () => {
  it('prefers displayName when present', () => {
    expect(guardName({ displayName: 'Hlídač Alex', username: 'alex123' })).toBe('Hlídač Alex');
  });

  it('falls back to username when displayName is null', () => {
    expect(guardName({ displayName: null, username: 'czhyenacz' })).toBe('czhyenacz');
  });

  it('falls back to username when displayName is undefined', () => {
    expect(guardName({ username: 'czhyenacz' })).toBe('czhyenacz');
  });
});
