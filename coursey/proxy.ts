import { NextResponse, type NextRequest } from 'next/server';
import { enabledRoute } from './route-gate';
import { resolveContext } from './runtime';

/** Coarse surface gate only. Identity, membership and RLS are checked again at data access. */
export async function platformProxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  if(!enabledRoute(path,request.method)) return NextResponse.json({ error:'Not enabled in platform development' }, { status:403 });
  const refreshedCookies:any[]=[];
  if(!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers.has('origin')) {
    try {if(new URL(request.headers.get('origin')!).host!==request.headers.get('host')) return NextResponse.json({ error:'Forbidden origin' },{ status:403 });}
    catch {return NextResponse.json({ error:'Forbidden origin' },{ status:403 });}
  }
  let context;
  try { context=await resolveContext(request.headers,request.cookies.getAll(),values=>{
    for(const cookie of values) {request.cookies.set(cookie.name,cookie.value);refreshedCookies.push(cookie);}
  }); }
  catch { return NextResponse.json({ error:'Unknown site or invalid identity' },{ status:404 }); }
  const bootstrap=['/ycode/api/supabase/config','/ycode/api/setup/status','/ycode/api/auth/session'];
  const protectedPath=path.startsWith('/ycode') || path.startsWith('/coursey/api/');
  if(protectedPath && !bootstrap.includes(path) && !(path==='/ycode' && !context.userId)) {
    if(!context.userId) return NextResponse.json({ error:'Authentication required' },{ status:401 });
    if(!context.role) return NextResponse.json({ error:'Forbidden' },{ status:403 });
    if(!['GET','HEAD','OPTIONS'].includes(request.method) && context.role==='viewer') return NextResponse.json({ error:'Forbidden' },{ status:403 });
  }
  if(context.role==='editor' && !['GET','HEAD','OPTIONS'].includes(request.method) && !/^\/ycode\/api\/collections\/[^/]+\/items(?:\/|$)/.test(path)) {
    return NextResponse.json({ error:'Forbidden' },{ status:403 });
  }
  const h=new Headers(request.headers);
  for(const name of [...h.keys()]) if(/^x-(tenant|site|coursey|forwarded-host)/i.test(name)) h.delete(name);
  h.set('x-pathname',path);
  h.set('cookie',request.cookies.toString());
  const response=NextResponse.next({ request:{ headers:h } });
  for(const cookie of refreshedCookies) response.cookies.set(cookie.name,cookie.value,cookie.options);
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
