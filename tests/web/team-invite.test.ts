import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const edgeFunction = readFileSync(path.join(import.meta.dirname, '../../supabase/functions/send-team-invite/index.ts'), 'utf8');
const migration = readFileSync(path.join(import.meta.dirname, '../../supabase/migrations/20261012072049_mark_team_invitation_sent.sql'), 'utf8');

describe('automatic team invitations', () => {
  it('requires a signed-in user and delegates owner validation to the database', () => {
    expect(edgeFunction).toContain('withSupabase({auth: "user"}');
    expect(edgeFunction).toContain('context.supabase.rpc("create_invitation"');
    expect(migration).toContain('perform private.require_owner()');
    expect(migration).toContain('revoke execute on function public.mark_invitation_sent(uuid) from public, anon, authenticated');
  });

  it('keeps email credentials server-side and marks only accepted deliveries', () => {
    expect(edgeFunction).toContain('Deno.env.get("RESEND_API_KEY")');
    expect(edgeFunction).toContain('https://api.resend.com/emails');
    expect(edgeFunction.indexOf('if (!emailResponse.ok)')).toBeLessThan(edgeFunction.indexOf('context.supabase.rpc("mark_invitation_sent"'));
    expect(edgeFunction).not.toContain('console.log');
  });
});
