import {randomBytes,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const token=()=>randomBytes(32).toString('base64url');
export const digest=v=>createHash('sha256').update(v).digest('hex');
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64);return `${salt}:${key.toString('hex')}`}
export async function passwordMatches(password,encoded){try{const [salt,hash]=encoded.split(':');const expected=Buffer.from(hash,'hex');const actual=await derive(password,salt,64);return expected.length===actual.length&&timingSafeEqual(actual,expected)}catch{return false}}
export function safeEqual(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)}
