import {describe, expect, it, vi} from 'vitest';

const storage = vi.hoisted(() => ({list: vi.fn(), remove: vi.fn()}));
vi.mock('../../src/lib/api', () => ({
  supabase: {storage: {from: () => storage}},
  errorMessage: (error: {message: string}) => error.message,
  check: (result: {error: unknown}) => { if (result.error) throw Error('Storage rejected deletion'); return result; },
}));
import {removeClientFiles} from '../../src/lib/documents';

describe('legacy document cleanup', () => {
  it('removes every page from offset zero without skipping remaining files', async () => {
    storage.list.mockReset().mockResolvedValueOnce({data: [{name: 'a'}, {name: 'b'}], error: null})
      .mockResolvedValueOnce({data: [{name: 'c'}], error: null}).mockResolvedValueOnce({data: [], error: null});
    storage.remove.mockReset().mockResolvedValue({data: [], error: null});
    await removeClientFiles(['qa-applicant']);
    expect(storage.remove.mock.calls.map(([paths]) => paths)).toEqual([['qa-applicant/a', 'qa-applicant/b'], ['qa-applicant/c']]);
    expect(storage.list).toHaveBeenCalledTimes(3);
  });

  it('reports failure instead of looping forever on a silent rejected delete', async () => {
    storage.list.mockReset().mockResolvedValue({data: [{name: 'stuck'}], error: null});
    storage.remove.mockReset().mockResolvedValue({data: [], error: null});
    await expect(removeClientFiles(['qa-applicant'])).rejects.toThrow(/Storage/);
    expect(storage.list).toHaveBeenCalledTimes(2);
  });
});
