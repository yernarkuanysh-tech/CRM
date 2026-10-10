import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,chmodSync,readdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
export function openStore(directory){mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'crm.sqlite');const db=new DatabaseSync(file);chmodSync(file,0o600);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL,actor_type TEXT NOT NULL DEFAULT 'owner',actor_id TEXT NOT NULL DEFAULT 'owner');
CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO metadata VALUES('revision','0');
DROP TABLE IF EXISTS connections;
DROP TABLE IF EXISTS oauth_states;
CREATE TABLE IF NOT EXISTS report_links(token_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,report_id TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);`);
 const sessionColumns=new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name));
 if(!sessionColumns.has('actor_type'))db.exec("ALTER TABLE sessions ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'owner'");
 if(!sessionColumns.has('actor_id'))db.exec("ALTER TABLE sessions ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'owner'");
 const getState=()=>({revision:Number(db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value),clients:db.prepare('SELECT data FROM clients ORDER BY rowid').all().map(r=>JSON.parse(r.data))});
 const audit=(event,detail='')=>db.prepare('INSERT INTO audit(at,event,detail) VALUES(?,?,?)').run(new Date().toISOString(),event,detail);
 const updateState=(clients,revision)=>{db.exec('BEGIN IMMEDIATE');try{if(getState().revision!==revision)throw Object.assign(Error('Данные изменились в другой вкладке. Обновите страницу перед сохранением.'),{status:409});db.prepare('DELETE FROM clients').run();const put=db.prepare('INSERT INTO clients VALUES(?,?)');for(const c of clients)put.run(c.id,JSON.stringify(c));db.prepare("UPDATE metadata SET value=? WHERE key='revision'").run(String(revision+1));audit('state_saved',String(clients.length));db.exec('COMMIT');return revision+1}catch(e){db.exec('ROLLBACK');throw e}};
 function backup(){const dir=path.join(directory,'backups');mkdirSync(dir,{recursive:true,mode:0o700});const dest=path.join(dir,`crm-${new Date().toISOString().slice(0,10)}.sqlite`);if(!existsSync(dest)){db.exec(`VACUUM INTO '${dest.replaceAll("'","''")}'`);chmodSync(dest,0o600)}const old=readdirSync(dir).filter(n=>/^crm-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().slice(0,-14);for(const name of old)unlinkSync(path.join(dir,name))}
 return {db,getState,updateState,audit,backup};
}
