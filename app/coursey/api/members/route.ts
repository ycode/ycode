import { requireSite } from '@/coursey/runtime';
import { createClient } from '@supabase/supabase-js';
export const dynamic='force-dynamic';
async function authorized() {
  const c=await requireSite('members');
  const api=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_PUBLISHABLE_KEY!,{
    auth:{ persistSession:false,autoRefreshToken:false },global:{ headers:{ Authorization:`Bearer ${c.token}` } } }).schema('coursey_api');
  return { c,api };
}
export async function GET() {
  try {
    const { c,api }=await authorized();
    const { data,error }=await api.rpc('members',{ target:c.id });
    if(error) return Response.json({ error:'Forbidden' },{ status:403 });
    return Response.json({ data },{ headers:{ 'Cache-Control':'private, no-store' } });
  } catch {return Response.json({ error:'Forbidden' },{ status:403 });}
}
export async function PUT(request:Request) {
  try {
    const { c,api }=await authorized(); const body=await request.json();
    if(!/^[0-9a-f-]{36}$/i.test(body.user_id)||!(body.role===null||['owner','admin','designer','editor','viewer'].includes(body.role))) return Response.json({ error:'Invalid membership' },{ status:400 });
    const { error }=await api.rpc('set_member',{ target:c.id,member:body.user_id,new_role:body.role });
    if(error) return Response.json({ error:'Forbidden' },{ status:403 });
    return Response.json({ ok:true });
  } catch {return Response.json({ error:'Forbidden' },{ status:403 });}
}
