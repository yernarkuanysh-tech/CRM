/** Local QA only: in-memory Postgres, synthetic accounts and a fake email provider.
 * Never uses .env.production, a remote database, or an external mail service.
 */
import {createServer} from 'node:http';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {handleInvitation} from '../../supabase/functions/send-team-invite/handler.ts';

const db = new PGlite({extensions: {pgcrypto}});
const owner = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
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
const passwords = new Map([['qa-owner@example.invalid', 'QA-only-password-123']]);
const base = 'http://127.0.0.1:54329';
const clientUrl = 'http://127.0.0.1:4175/';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (id: string) => `${encode({alg: 'HS256'})}.${encode({sub: id, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600})}.qa-only-signature`;
function identity(header = '') {
  try { return JSON.parse(Buffer.from(header.split('.')[1], 'base64url').toString()).sub as string; }
  catch { return ''; }
}
const rpcNames = new Set(['crm_initialized', 'crm_settings', 'team_overview', 'create_invitation', 'inspect_invitation', 'accept_invitation', 'mark_invitation_sent', 'revoke_invitation', 'save_clients', 'delete_client', 'update_settings', 'set_member_role', 'set_staff_status']);
async function rpc(name: string, args: Record<string, unknown>, id: string) {
  if (!rpcNames.has(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw Error('Unsupported QA RPC');
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: id || null, session_id: sessionId})]);
    await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as result`;
    return (await tx.query<{result: unknown}>(sql, keys.map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]))).rows[0].result;
  });
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || '/', base);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  const id = identity(req.headers.authorization);
  try {
    if (url.pathname === '/auth/v1/logout') { res.end('{}'); return; }
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/signup') {
      const email = String(body.email || '').toLowerCase();
      if (!email.endsWith('@example.invalid')) throw Error('QA accepts only example.invalid accounts');
      if (url.pathname.endsWith('signup')) {
        await db.query('insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)', [crypto.randomUUID(), email, JSON.stringify(body.data || {})]);
        passwords.set(email, body.password);
      }
      if (passwords.get(email) !== body.password) throw Error('Invalid login credentials');
      const user = (await db.query<{id: string}>('select id from auth.users where email = $1', [email])).rows[0];
      await db.query('insert into auth.sessions (id, user_id) values ($1, $2) on conflict (id) do update set user_id = excluded.user_id', [sessionId, user.id]);
      res.end(JSON.stringify({access_token: jwt(user.id), refresh_token: 'qa-refresh', token_type: 'bearer', expires_in: 3600, user: {id: user.id, email, app_metadata: {}, user_metadata: {}}})); return;
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      res.end(JSON.stringify(await rpc(url.pathname.split('/').pop()!, body, id))); return;
    }
    if (url.pathname === '/rest/v1/clients') {
      const rows = await db.transaction(async tx => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: id || null, session_id: sessionId})]);
        await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
        return (await tx.query('select id, data, revision from public.clients order by position desc')).rows;
      });
      res.end(JSON.stringify(rows)); return;
    }
    if (url.pathname === '/functions/v1/send-team-invite') {
      const response = await handleInvitation(new Request(base + url.pathname, {method: 'POST', body: raw}), {
        supabase: {rpc: async (name, args) => { try { return {data: await rpc(name, args || {}, id), error: null}; } catch (error) { return {data: null, error: {message: String(error)}}; } }},
        resendKey: 'qa-placeholder', from: 'qa@example.invalid', siteUrl: clientUrl,
        fetch: async () => Response.json({id: 'qa-simulated-mail'}),
      });
      res.statusCode = response.status; res.end(await response.text()); return;
    }
    res.statusCode = 404; res.end(JSON.stringify({message: 'Unknown QA endpoint'}));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({message: String(error)})); }
}).listen(54329, '127.0.0.1', () => console.log('QA API ready: http://127.0.0.1:54329 (synthetic data only)'));
