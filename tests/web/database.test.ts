import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {buildReport, reportStages} from '../../src/lib/reports';
import {iso, today} from '../../src/lib/dates';
import type {Client} from '../../src/types';

const owner = '10000000-0000-4000-8000-000000000001';
const outsider = '10000000-0000-4000-8000-000000000002';
const staff = '10000000-0000-4000-8000-000000000003';
const sessionId = '20000000-0000-4000-8000-000000000001';
const token = 'A'.repeat(43), secondToken = 'B'.repeat(43);
let db: PGlite;
let testing = false;

async function asUser(id: string, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({sub: id, session_id: sessionId})]);
  await db.query('insert into auth.sessions (id, user_id) values ($1, $2) on conflict (id) do update set user_id = excluded.user_id', [sessionId, id]);
  await db.exec(`set role ${role}`);
}

const createInvite = (email = 'qa-staff@example.invalid', tag = token) => db.query<{invite: {id: string; token: string}}>(
  'select public.create_invitation($1, $2, $3) as invite', [email, 'QA Staff', tag]);

const card = (): Client => ({id: 'qa-applicant', name: 'QA Applicant', year: 2027, level: 'Магистратура', apps: [], tasks: [], tags: ['Bolashak']});
const save = (c: Client, revision: number | null = null) => db.query('select public.save_clients($1::jsonb)', [JSON.stringify([{data: c, revision}])]);

beforeAll(async () => {
  db = new PGlite({extensions: {pgcrypto}});
  // Test-only substitutes for Supabase platform schemas, never pointed at production.
  // All application migrations, RLS policies and pgcrypto execute unchanged.
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin;
    create schema auth; create schema extensions; create schema storage;
    create table auth.users (id uuid primary key, email text unique, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb default '{}', encrypted_password text, updated_at timestamptz);
    create table auth.sessions (id uuid primary key, user_id uuid references auth.users);
    create table auth.refresh_tokens (user_id text);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, delete on storage.objects to anon, authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  `);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [owner, 'qa-owner@example.invalid']);
  await db.exec('alter table auth.users disable trigger crm_on_auth_user_created');
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [outsider, 'qa-existing@example.invalid']);
  await db.exec('alter table auth.users enable trigger crm_on_auth_user_created');
  const query = db.query.bind(db);
  // Rejected queries are rolled back to a savepoint so later assertions can still
  // inspect state; each test's outer transaction is rolled back in afterEach.
  db.query = (async (...args: Parameters<typeof db.query>) => {
    if (!testing) return query(...args);
    await db.exec('savepoint qa_call');
    try {
      const result = await query(...args);
      await db.exec('release savepoint qa_call');
      return result;
    } catch (error) {
      await db.exec('rollback to savepoint qa_call; release savepoint qa_call');
      throw error;
    }
  }) as typeof db.query;
}, 30000);

beforeEach(async () => { await db.exec('begin'); testing = true; await asUser(owner); });
afterEach(async () => { testing = false; await db.exec('reset role; rollback'); });
afterAll(async () => { await db?.close(); });

describe('server invitations and access', () => {
  it('creates one invitation on retry, stores only a hash, and invalidates renewed links', async () => {
    const first = (await createInvite()).rows[0].invite;
    expect((await createInvite()).rows[0].invite.id).toBe(first.id);
    expect((await db.query<{count: number}>('select count(*)::int as count from public.team_overview()')).rows).toHaveLength(1);
    await db.exec('reset role');
    const row = (await db.query<{token_hash: string; count: number}>('select token_hash, count(*) over ()::int as count from private.invitations')).rows[0];
    expect(row.count).toBe(1); expect(row.token_hash).not.toBe(token);
    await asUser(owner);
    await createInvite('qa-staff@example.invalid', secondToken);
    await expect(db.query('select public.inspect_invitation($1)', [token])).rejects.toThrow(/истекло|использовано/);
    expect((await db.query('select public.inspect_invitation($1)', [secondToken])).rows).toHaveLength(1);
  });

  it('new signup consumes a matching token, ignores requested owner role and cannot reuse it', async () => {
    await createInvite();
    await db.exec('reset role');
    await db.query('insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)',
      [staff, 'qa-staff@example.invalid', JSON.stringify({invite_token: token, role: 'owner'})]);
    expect((await db.query<{role: string}>('select role from private.profiles where id = $1', [staff])).rows[0].role).toBe('staff');
    await expect(db.query('select public.inspect_invitation($1)', [token])).rejects.toThrow();
    await asUser(staff);
    await expect(createInvite('qa-forbidden@example.invalid')).rejects.toThrow(/владельцу/);
    await expect(db.query('select public.delete_client($1, 1)', ['anything'])).rejects.toThrow(/владельцу/);
    await expect(db.query("select public.save_clients('[]', '[{\"id\":\"anything\",\"revision\":1}]')")).rejects.toThrow(/владельцу/);
  });

  it('existing account joins only after login with the invited confirmed email', async () => {
    await createInvite('qa-existing@example.invalid');
    expect((await db.query<{info: {existingAccount: boolean}}>('select public.inspect_invitation($1) as info', [token])).rows[0].info.existingAccount).toBe(true);
    await expect(db.query('select public.accept_invitation($1)', [token])).rejects.toThrow();
    await asUser(outsider);
    await db.query('select public.accept_invitation($1)', [token]);
    expect((await db.query<{s: {currentUser: {role: string}}}>('select public.crm_settings() as s')).rows[0].s.currentUser.role).toBe('staff');
    await expect(db.query('select public.accept_invitation($1)', [token])).rejects.toThrow();
  });

  it('rejects expired/revoked tokens and never marks a replacement token as sent', async () => {
    const invitation = (await createInvite()).rows[0].invite;
    await createInvite('qa-staff@example.invalid', secondToken);
    await expect(db.query('select public.mark_invitation_sent($1, $2)', [invitation.id, token])).rejects.toThrow();
    await db.query('select public.mark_invitation_sent($1, $2)', [invitation.id, secondToken]);
    await db.exec('reset role');
    await db.query("update private.invitations set expires_at = now() - interval '1 second' where id = $1", [invitation.id]);
    await expect(db.query('select public.inspect_invitation($1)', [secondToken])).rejects.toThrow();
    await asUser(owner);
    const renewed = (await createInvite()).rows[0].invite;
    await db.query('select public.revoke_invitation($1)', [renewed.id]);
    await expect(db.query('select public.inspect_invitation($1)', [token])).rejects.toThrow();
  });

  it('counts pending invitations, permits renewal at capacity and rejects the 11th seat', async () => {
    for (let i = 0; i < 10; i++) await createInvite(`qa-${i}@example.invalid`, `${String(i).repeat(43)}`);
    await expect(createInvite('qa-11@example.invalid')).rejects.toThrow(/лимит/);
    await createInvite('qa-0@example.invalid', token);
  });

  it('RLS blocks outsiders, unconfirmed and disabled members; revocation rejects an old JWT', async () => {
    await save(card());
    await asUser(outsider);
    expect((await db.query('select * from public.clients')).rows).toHaveLength(0);
    await expect(save({...card(), id: 'forbidden'})).rejects.toThrow(/Войдите/);
    await asUser(owner);
    await createInvite();
    await db.exec('reset role');
    await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [staff, 'qa-staff@example.invalid', JSON.stringify({invite_token: token})]);
    await asUser(staff);
    expect((await db.query('select * from public.clients')).rows).toHaveLength(0);
    await db.exec('reset role');
    await db.query('update auth.users set email_confirmed_at = now() where id = $1', [staff]);
    await asUser(staff);
    expect((await db.query('select * from public.clients')).rows).toHaveLength(1);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where user_id = $1', [staff]);
    await db.exec('set role authenticated');
    expect((await db.query('select * from public.clients')).rows).toHaveLength(0);
    await expect(save({...card(), id: 'revoked'})).rejects.toThrow(/сессия|Сессия/);
    await asUser(owner);
    await db.query("select public.set_staff_status($1, 'disabled')", [staff]);
    await asUser(staff);
    expect((await db.query('select * from public.clients')).rows).toHaveLength(0);
    await expect(db.query('select public.update_settings($1, $2, 2027)', ['Bad', 'Bad'])).rejects.toThrow();
  });

  it('anonymous callers cannot invoke team management or directly read private tables', async () => {
    await db.exec('set role anon');
    await expect(createInvite()).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.team_overview()')).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from private.profiles')).rejects.toThrow(/permission denied/);
  });

  it('recovery codes are one-time and reset sessions; disabled owners cannot recover access', async () => {
    await db.exec('reset role');
    await db.query("update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf')) where id = $2", ['QA-password-only-123', owner]);
    await asUser(owner);
    const code = (await db.query<{code: string}>('select public.create_recovery_code($1) as code', ['QA-password-only-123'])).rows[0].code;
    await db.exec('set role anon');
    await db.query('select public.recover_owner_password($1, $2, $3)', ['qa-owner@example.invalid', code, 'QA-new-password-456']);
    await expect(db.query('select public.recover_owner_password($1, $2, $3)', ['qa-owner@example.invalid', code, 'QA-new-password-789'])).rejects.toThrow();
    await db.exec('set role authenticated');
    expect((await db.query('select * from public.clients')).rows).toHaveLength(0);
    await expect(createInvite()).rejects.toThrow(/Сессия/);
  });

  it('staff cannot promote themselves, enable themselves or edit workspace settings', async () => {
    await createInvite();
    await db.exec('reset role');
    await db.query('insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)', [staff, 'qa-staff@example.invalid', JSON.stringify({invite_token: token})]);
    await asUser(staff);
    await expect(db.query("select public.set_member_role($1, 'owner')", [staff])).rejects.toThrow(/владельцу/);
    await expect(db.query("select public.set_staff_status($1, 'active')", [staff])).rejects.toThrow(/владельцу/);
    await expect(db.query('select public.update_settings($1, $2, 2027)', ['Forged', 'Forged'])).rejects.toThrow(/владельцу/);
  });
});

describe('server card integrity', () => {
  it('saves related records and tags, increments revisions, rejects stale saves, cascades document metadata', async () => {
    const c = card(); c.tasks.push({id: 'task', title: 'QA task', date: '2027-01-01', done: false});
    c.apps.push({id: 'app', university: 'QA University', program: 'CS', country: 'USA', deadline: '2027-01-01', status: 'Подана'});
    await save(c);
    c.tasks[0].done = true;
    await save(c, 1);
    expect((await db.query<{data: Client; revision: number}>('select data, revision from public.clients')).rows[0]).toMatchObject({revision: 2, data: {tags: ['Bolashak'], tasks: [{done: true}]}});
    await expect(save(c, 1)).rejects.toThrow(/другой/);
    await db.query('insert into public.client_documents (client_id, name, size) values ($1, $2, $3)', [c.id, 'qa.pdf', 100]);
    await db.query('select public.delete_client($1, $2)', [c.id, 2]);
    expect((await db.query('select * from public.client_documents')).rows).toHaveLength(0);
  });

  it('rejects missing fields, invalid calendar dates and duplicate tags even through the API', async () => {
    const badTask = {...card(), tasks: [{id: 'task', date: '2026-02-31', done: false}]};
    await expect(save(badTask as Client)).rejects.toThrow();
    await expect(save({...card(), tags: ['Bolashak', 'bolashak']})).rejects.toThrow();
    await expect(save({...card(), apps: [{id: 'a', status: 'Подана'}]} as Client)).rejects.toThrow();
  });

  it('cannot forge acknowledgement, mutate recorded events or remove saved reports', async () => {
    const c = card();
    const r = buildReport(c, {stage: reportStages[0], from: iso(today), to: iso(today), done: 'Done', next: 'Next', clientAction: 'Action', appIds: []});
    c.reports = [r]; await save(c);
    r.ack = {date: iso(today), channel: 'Email', note: 'Read', recordedAt: new Date().toISOString(), source: 'admin_manual'};
    await expect(save(c, 1)).rejects.toThrow();
    r.ack = null;
    r.sent = {date: iso(today), channel: 'Email', note: '', recordedAt: new Date().toISOString(), source: 'admin_manual'};
    await save(c, 1);
    r.sent.channel = 'WhatsApp';
    await expect(save(c, 2)).rejects.toThrow(/отметку/);
    c.reports = [];
    await expect(save(c, 2)).rejects.toThrow(/удалить/);
  });

  it('storage and metadata are private, uploads must refer to an existing applicant', async () => {
    await save(card());
    await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', ['client-documents', 'qa-applicant/qa-document']);
    await expect(db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', ['client-documents', 'missing/qa-document'])).rejects.toThrow();
    await asUser(outsider);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
    expect((await db.query('select * from public.client_documents')).rows).toHaveLength(0);
  });
});
