import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const migration = readFileSync(path.join(import.meta.dirname, '../../supabase/migrations/20261010130000_delete_client.sql'), 'utf8');

describe('client deletion database contract', () => {
  it('requires the owner and an unchanged revision before deleting', () => {
    expect(migration).toContain('alter function public.save_clients(jsonb, jsonb) set schema private');
    expect(migration).toMatch(/jsonb_array_length\(p_deletes\) > 0[\s\S]*private\.require_owner\(\)/);
    expect(migration).toContain('perform private.require_owner()');
    expect(migration).toMatch(/where id = p_id and revision = p_revision/);
    expect(migration).toContain("private.audit('client_deleted'");
  });
});
