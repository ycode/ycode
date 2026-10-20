import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { headers, cookies } from 'next/headers';
import knexFactory, { type Knex } from 'knex';

export const platformEnabled = () => process.env.COURSEY_PLATFORM === 'true';
export type SiteContext = {id:string; schema_name:string; role:string|null; userId:string|null; token:string|null};

export async function requestContext(): Promise<SiteContext> {
  return resolveContext(await headers(), (await cookies()).getAll());
}

export async function resolveContext(h:Headers, cookieList:{name:string;value:string}[], setCookies?:(values:{name:string;value:string;options:CookieOptions}[])=>void): Promise<SiteContext> {
  const rawHost=h.get('host');
  if(!rawHost || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(rawHost)) throw new Error('Unknown site');
  const hostname=rawHost.split(':')[0].toLowerCase();
  const url=process.env.SUPABASE_URL!;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY!;
  let token:string|null=null, userId:string|null=null;
  const authorization=h.get('authorization');
  if(authorization) {
    if(!authorization.startsWith('Bearer ')) throw new Error('Invalid identity');
    token=authorization.slice(7);
    const auth=createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false } });
    const { data,error }=await auth.auth.getUser(token);
    if(error || !data.user) throw new Error('Invalid identity');
    userId=data.user.id;
  } else {
    const auth=createServerClient(url,key,{ cookieOptions:{ name:'coursey-auth',sameSite:'lax',secure:process.env.NODE_ENV==='production' },cookies:{ getAll:()=>cookieList,setAll:(values)=>setCookies?.(values) } });
    const { data:{ user } }=await auth.auth.getUser();
    if(user) {
      userId=user.id;
      const { data:{ session } }=await auth.auth.getSession();
      token=session?.access_token ?? null;
      if(!token) throw new Error('Invalid identity');
    }
  }
  const client=createClient(url,key,{ auth:{ persistSession:false,autoRefreshToken:false },
    global:{ headers:token?{ Authorization:`Bearer ${token}` }:{},fetch:(input,init)=>fetch(input,{ ...init,cache:'no-store' }) } });
  const { data,error }=await client.schema('coursey_api').rpc('resolve_site',{ hostname });
  const site=data?.[0];
  if(error || data?.length !== 1 || !site || !/^site_[a-z0-9_]+$/.test(site.schema_name)) throw new Error('Unknown site');
  return { ...site,userId,token };
}

export async function requireSite(capability:'read'|'design'|'cms'|'members'='read') {
  const context=await requestContext();
  const roles=capability==='read'?['owner','admin','designer','editor','viewer']:
    capability==='members'?['owner','admin']:capability==='cms'?['owner','admin','designer','editor']:['owner','admin','designer'];
  if(!context.userId || !context.role || !roles.includes(context.role)) throw new Error('Forbidden');
  return context;
}

/** Legacy callers get a site-scoped, RLS-enforced user client, NOT a service client. */
export async function siteClient(): Promise<SupabaseClient> {
  const context=await requestContext();
  const client=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{
    db:{ schema:context.schema_name },auth:{ persistSession:false,autoRefreshToken:false },
    global:{ headers:context.token?{ Authorization:`Bearer ${context.token}` }:{},
      fetch:(input,init)=>fetch(input,{ ...init,cache:'no-store' }) } });
  const storageFrom=client.storage.from.bind(client.storage);
  client.storage.from=(bucket:string)=>{
    if(bucket!=='assets') throw new Error('Unsupported storage bucket');
    const bucketClient=storageFrom(context.schema_name);
    bucketClient.getPublicUrl=(file:string)=>({ data:{ publicUrl:`/coursey/assets/${file.split('/').map(encodeURIComponent).join('/')}` } });
    return bucketClient;
  };
  return client as unknown as SupabaseClient;
}

// Pools are keyed by immutable verified identity AND schema, never by just host.
// PostgreSQL RLS performs live membership checks for every query (including revocation).
const pools=new Map<string,Knex>();
export async function siteSql():Promise<Knex> {
  const context=await requestContext();
  const key=`${context.schema_name}:${context.userId??'anonymous'}`;
  let db=pools.get(key);
  if(db) return db;
  if(pools.size>=32) {
    const oldest=pools.entries().next().value;
    if(oldest) {pools.delete(oldest[0]);void oldest[1].destroy();}
  }
  db=knexFactory({ client:'pg',connection:process.env.COURSEY_DATABASE_URL!,
    pool:{ min:0,max:1,afterCreate:(connection:any,done:any)=>{
      connection.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',(privilegeError:unknown,result:any)=>{
        if(privilegeError || !result?.rows[0] || result.rows[0].rolsuper || result.rows[0].rolbypassrls) return done(new Error('Privileged runtime database role rejected'),connection);
        connection.query('SELECT set_config($1,$2,false),set_config($3,$4,false)',
          ['search_path',`${context.schema_name},pg_catalog`,'request.jwt.claim.sub',context.userId??''],(error:unknown)=>{
            if(error) return done(error,connection);
            connection.query(`SET ROLE ${context.userId?'authenticated':'anon'}`,(e:unknown)=>done(e,connection));
          });
      });
    } } });
  pools.set(key,db);
  return db;
}
