import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {handleInvitation, type InvitationDependencies} from '../../supabase/functions/send-team-invite/handler';
import {classifyFunctionError, FunctionRequestUncertainError, FunctionUnavailableError, newInvitationToken, sendInvitation} from '../../src/lib/invitations';

const token = 'A'.repeat(43);
const input = {email: 'qa@example.invalid', name: 'QA <Tester>', token};
const invitation = {...input, id: '10000000-0000-4000-8000-000000000001'};
const request = () => new Request('https://example.invalid/invite', {method: 'POST', body: JSON.stringify(input)});
function dependencies(): InvitationDependencies {
  return {siteUrl: 'https://crm.example.invalid/', resendKey: 'test-key-not-real', from: 'QA <qa@example.invalid>',
    supabase: {rpc: vi.fn(async name => ({data: name === 'create_invitation' ? invitation : name === 'crm_settings' ? {organization: 'GrantEd <QA>'} : null, error: null}))},
    fetch: vi.fn(async () => Response.json({id: 'test-message'})) as typeof fetch,
  };
}

describe('invitation handler with simulated mail provider', () => {
  it('passes the attempt token to the owner-protected RPC and mails only after creation', async () => {
    const deps = dependencies();
    const result = await (await handleInvitation(request(), deps)).json();
    expect(result.sent).toBe(true);
    expect(deps.supabase.rpc).toHaveBeenCalledWith('create_invitation', {p_email: input.email, p_name: input.name, p_token: token});
    expect(deps.supabase.rpc).toHaveBeenCalledWith('mark_invitation_sent', {p_id: invitation.id, p_token: token});
    const [, options] = vi.mocked(deps.fetch).mock.calls[0];
    expect(options?.headers).toHaveProperty('Idempotency-Key');
    expect(String(options?.body)).toContain('QA &lt;Tester&gt;');
    expect(JSON.stringify(result)).not.toContain(deps.resendKey);
  });

  it('reuses the provider idempotency key for a retry of the same token', async () => {
    const deps = dependencies();
    await handleInvitation(request(), deps); await handleInvitation(request(), deps);
    const calls = vi.mocked(deps.fetch).mock.calls;
    expect(calls[0][1]?.headers).toEqual(calls[1][1]?.headers);
  });

  it('never mails or marks sent if the owner check rejects creation', async () => {
    const deps = dependencies();
    deps.supabase.rpc = vi.fn(async () => ({data: null, error: {message: 'Owner required'}}));
    const result = await handleInvitation(request(), deps);
    expect(result.status).toBe(400); expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each(['resendKey', 'from', 'siteUrl'] as const)('reports the missing %s configuration without pretending to send', async key => {
    const deps = dependencies(); deps[key] = undefined;
    const result = await (await handleInvitation(request(), deps)).json();
    expect(result.sent).toBe(false); expect(result.warning).toContain('не отправлено');
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('reports provider rejection and does not mark the invitation as sent', async () => {
    const deps = dependencies(); deps.fetch = vi.fn(async () => new Response('secret provider detail', {status: 403})) as typeof fetch;
    const result = await (await handleInvitation(request(), deps)).json();
    expect(result.sent).toBe(false); expect(result.warning).toContain('403');
    expect(result.warning).not.toContain('secret provider detail');
    expect(vi.mocked(deps.supabase.rpc).mock.calls.some(([name]) => name === 'mark_invitation_sent')).toBe(false);
  });

  it('keeps the invitation link on provider timeout and reports uncertainty', async () => {
    const deps = dependencies(); deps.fetch = vi.fn(async () => { throw Error('Timeout'); }) as typeof fetch;
    const result = await (await handleInvitation(request(), deps)).json();
    expect(result.sent).toBe(false); expect(result.inviteUrl).toContain(token); expect(result.warning).toContain('неизвестен');
  });

  it('distinguishes provider acceptance from failure to record status', async () => {
    const deps = dependencies();
    const rpc = deps.supabase.rpc;
    deps.supabase.rpc = vi.fn(async (name, args) => name === 'mark_invitation_sent' ? {data: null, error: {message: 'Token replaced'}} : rpc(name, args));
    const result = await (await handleInvitation(request(), deps)).json();
    expect(result.sent).toBe(true); expect(result.warning).toContain('не записан');
  });

  it('rejects malformed body and unsupported methods', async () => {
    const deps = dependencies();
    expect((await handleInvitation(new Request('https://example.invalid', {method: 'POST', body: 'null'}), deps)).status).toBe(400);
    expect((await handleInvitation(new Request('https://example.invalid'), deps)).status).toBe(405);
    expect(deps.supabase.rpc).not.toHaveBeenCalled();
  });

  it('keeps authentication and CORS at the deployed entrypoint', () => {
    const entry = readFileSync(new URL('../../supabase/functions/send-team-invite/index.ts', import.meta.url), 'utf8');
    expect(entry).toContain('withSupabase({auth: "user"}');
  });
});

describe('browser invitation transport', () => {
  it('creates a manual link only for a definite HTTP 404', async () => {
    const invoke = vi.fn(async () => { throw classifyFunctionError({context: new Response('', {status: 404})}); });
    const create = vi.fn(async () => invitation);
    const result = await sendInvitation(input, {invoke, create, siteUrl: 'https://crm.example.invalid/#settings'});
    expect(result.sent).toBe(false); expect(result.inviteUrl).toBe('https://crm.example.invalid/#invite/' + token);
    expect(create).toHaveBeenCalledOnce();
  });

  it('does not create or claim success after an ambiguous fetch/relay failure', async () => {
    for (const name of ['FunctionsFetchError', 'FunctionsRelayError']) {
      const create = vi.fn(async () => invitation);
      const invoke = vi.fn(async () => { throw classifyFunctionError({name}); });
      await expect(sendInvitation(input, {invoke, create, siteUrl: 'https://crm.example.invalid/'})).rejects.toBeInstanceOf(FunctionRequestUncertainError);
      expect(create).not.toHaveBeenCalled();
    }
    expect(classifyFunctionError({context: new Response('', {status: 404})})).toBeInstanceOf(FunctionUnavailableError);
    expect(classifyFunctionError({context: new Response('', {status: 401})})).toBe(null);
  });

  it('generates independent 256-bit URL-safe attempt tokens', () => {
    const first = newInvitationToken(), second = newInvitationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(first).not.toBe(second);
  });
});
