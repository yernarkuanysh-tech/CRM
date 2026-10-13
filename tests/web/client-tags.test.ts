import {describe, expect, it} from 'vitest';
import {normalizeClientTags} from '../../src/lib/crm';

describe('applicant tags', () => {
  it('trims, splits and removes case-insensitive duplicates', () => {
    expect(normalizeClientTags([' Bolashak ', 'Fully funded Master, scholarship', 'bolashak']))
      .toEqual(['Bolashak', 'Fully funded Master', 'scholarship']);
  });

  it('enforces the per-card limits', () => {
    expect(() => normalizeClientTags(['x'.repeat(41)])).toThrow('40');
    expect(() => normalizeClientTags(Array.from({length: 21}, (_, index) => `Tag ${index}`))).toThrow('20');
  });
});
