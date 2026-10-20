import { requireSite } from '@/coursey/runtime';
export const dynamic='force-dynamic';
export async function GET() {
  try {const c=await requireSite();return Response.json({ role:c.role },{ headers:{ 'Cache-Control':'private, no-store' } });}
  catch {return Response.json({ error:'Forbidden' },{ status:403 });}
}
