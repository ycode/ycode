import { CONTENT_ROUTES } from './routes';
const routePatterns=CONTENT_ROUTES.map(route=>new RegExp('^'+route.replace(/\[(id|field_id|item_id)\]/g,'[0-9a-fA-F-]{36}').replace('[key]','(?!agent$)[a-z_]+').replace('[layoutKey]','[a-z-]+')+'$'));
export function enabledRoute(path:string,method:string) {
  if(path==='/coursey/api/context'||path==='/coursey/api/members'||path.startsWith('/coursey/assets/')) return true;
  if(path.startsWith('/api/') || path.startsWith('/ycode/mcp') || path.startsWith('/.well-known/')) return false;
  if(path.startsWith('/ycode/api/')) return routePatterns.some(pattern=>pattern.test(path));
  if(path.startsWith('/ycode/')) return !/\/(devtools|integrations|oauth|profile|welcome|accept-invite)(\/|$)/.test(path);
  return method==='GET'||method==='HEAD';
}
