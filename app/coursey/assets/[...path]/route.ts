import { siteClient } from '@/coursey/runtime';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{ params }:{params:Promise<{path:string[]}>}) {
  try {
    const { path }=await params;
    if(path.some(p=>p==='..'||p==='.'||p.includes('/'))) return new Response(null,{ status:404 });
    const client=await siteClient();
    const { data,error }=await client.storage.from('assets').download(path.join('/'));
    if(error||!data) return new Response(null,{ status:404 });
    return new Response(data,{ headers:{ 'Content-Type':data.type||'application/octet-stream',
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox" } });
  } catch {return new Response(null,{ status:404 });}
}
