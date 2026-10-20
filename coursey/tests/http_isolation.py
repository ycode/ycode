#!/usr/bin/env python3
"""Real GoTrue/PostgREST/storage + native Next handlers. Tokens never printed."""
import json,pathlib,unittest,urllib.request,urllib.error,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
STATE=json.loads((ROOT/'coursey/test-results/identities.json').read_text())
SECRETS=dict(l.split('=',1) for l in pathlib.Path('/opt/ccpm/dev-secrets/coursey.env').read_text().splitlines() if '=' in l)


def request(path,method='GET',body=None,user=None,site='alpha',schema=None,raw=False,extra=None):
    headers={'Host':site.replace('_','-')+'.localhost:3310'}
    base='http://127.0.0.1:3310'
    if schema:
        base='http://127.0.0.1:54329/rest/v1'
        headers.update({'apikey':SECRETS['DEV_ANON_KEY'],'Accept-Profile':schema,'Content-Profile':schema})
    if user: headers['Authorization']='Bearer '+TOKENS[user]
    if body is not None:
        if not raw: body=json.dumps(body).encode();headers['Content-Type']='application/json'
    if extra: headers.update(extra)
    req=urllib.request.Request(base+path,data=body,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=120) as r: code=r.status;data=r.read();response_headers=dict(r.headers)
    except urllib.error.HTTPError as e:
        code=e.code;data=e.read();response_headers=dict(e.headers);e.close()
    try: data=json.loads(data)
    except (ValueError,UnicodeDecodeError): data=data.decode(errors='replace')
    return code,data,response_headers


def storage(path,method='GET',body=None,user=None):
    headers={'apikey':SECRETS['DEV_ANON_KEY'],'Authorization':'Bearer '+(TOKENS[user] if user else SECRETS['DEV_ANON_KEY'])}
    if body:
        if isinstance(body,dict):body=json.dumps(body).encode();headers['Content-Type']='application/json'
        else:headers['Content-Type']='text/plain'
    req=urllib.request.Request('http://127.0.0.1:54329/storage/v1'+path,data=body,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return r.status,r.read()
    except urllib.error.HTTPError as e:
        result=(e.code,e.read());e.close();return result


TOKENS={}
for name in STATE['users']:
    req=urllib.request.Request('http://127.0.0.1:54329/auth/v1/token?grant_type=password',
        data=json.dumps({'email':name+'@coursey.invalid','password':STATE['password']}).encode(),
        headers={'apikey':SECRETS['DEV_ANON_KEY'],'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as r:TOKENS[name]=json.load(r)['access_token']


class Isolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        request('/coursey/api/members','PUT',{'user_id':STATE['users']['removed'],'role':'designer'},user='alpha')
        cls.pages={}
        for site in ['alpha','beta']:
            code,data,_=request('/ycode/api/pages','POST',{'name':'Private '+site,'slug':'private-'+uuid.uuid4().hex[:8]},user=site,site=site)
            if code!=200: raise AssertionError(f'{site} page creation failed: {code} {data}')
            cls.pages[site]=data['data']['id']

    def test_01_native_editor_initialization_is_site_scoped(self):
        for site,other in [('alpha','beta'),('beta','alpha')]:
            code,data,_=request('/ycode/api/editor/init',user=site,site=site)
            self.assertEqual(code,200,data)
            ids={p['id'] for p in data['data']['pages']}
            self.assertIn(self.pages[site],ids);self.assertNotIn(self.pages[other],ids)

    def test_02_guessed_page_ids_and_forged_tenant_header(self):
        for site,other in [('alpha','beta'),('beta','alpha')]:
            for method,body in [('GET',None),('PUT',{'name':'attack'})]:
                code,data,_=request('/ycode/api/pages/'+self.pages[other],method,body,user=site,site=site,
                    extra={'X-Tenant-Id':STATE['sites'][other],'X-Coursey-Site':STATE['sites'][other]})
                self.assertEqual(code,404,data)
        self.assertEqual(request('/ycode/api/pages',user='alpha',site='beta')[0],403)

    def test_03_anonymous_nonmember_viewer_and_editor(self):
        self.assertEqual(request('/ycode/api/pages')[0],401)
        self.assertEqual(request('/ycode/api/pages',user='outsider')[0],403)
        self.assertEqual(request('/ycode/api/pages',user='viewer')[0],200)
        for user in ['viewer','editor']:
            code,_,_=request('/ycode/api/pages/'+self.pages['alpha'],'PUT',{'name':'not permitted'},user=user)
            self.assertIn(code,[403],user)
        self.assertEqual(request('/ycode/api/pages/'+self.pages['alpha'],'PUT',{'name':'Designer edit'},user='designer')[0],200)

    def test_04_direct_rest_policies_and_settings(self):
        for table in ['pages','page_layers','assets','settings','collections','collection_items','collection_item_values']:
            code,data,_=request('/'+table+('' if table=='settings' else '?is_published=eq.false'),user='alpha',schema='site_beta')
            self.assertEqual(code,200)
            if table=='settings': self.assertFalse(any(p['key']=='email' for p in data))
            else: self.assertEqual(data,[],table)
        code,_,_=request('/pages?id=eq.'+self.pages['beta'],'PATCH',{'name':'direct attack'},user='alpha',schema='site_beta')
        self.assertEqual(code,204) # Zero affected rows; verify persisted state, not status alone.
        code,data,_=request('/pages?id=eq.'+self.pages['beta'],user='beta',schema='site_beta')
        self.assertNotEqual(data[0]['name'],'direct attack')
        self.assertEqual(request('/settings','POST',{'key':'email','value':{'password':'synthetic-private'}},user='alpha',schema='site_beta')[0],403)
        self.assertEqual(request('/ycode/api/settings/email','PUT',{'value':{'host':'private-alpha'}},user='alpha')[0],200)
        self.assertEqual(request('/ycode/api/settings/email',user='alpha',site='beta')[0],403)
        code,data,_=request('/settings?key=eq.email',schema='site_alpha')
        self.assertEqual(data,[])

    def test_05_memberships_and_revocation(self):
        self.assertEqual(request('/coursey/api/members',user='alpha',site='beta')[0],403)
        self.assertEqual(request('/coursey/api/members',user='designer')[0],403)
        self.assertEqual(request('/coursey/api/members','PUT',{'user_id':STATE['users']['alpha'],'role':None},user='alpha')[0],403)
        self.assertEqual(request('/coursey/api/members','PUT',{'user_id':STATE['users']['removed'],'role':None},user='alpha')[0],200)
        self.assertEqual(request('/ycode/api/pages',user='removed')[0],403)
        code,data,_=request('/pages?is_published=eq.false',user='removed',schema='site_alpha')
        self.assertEqual(data,[])
        # Customer A owns two sites but a new member is not automatically in both.
        self.assertEqual(request('/ycode/api/pages',user='alpha',site='alpha_two')[0],200)
        self.assertEqual(request('/ycode/api/pages',user='designer',site='alpha_two')[0],403)

    def test_07_native_preview_edit_and_publication(self):
        for site,other in [('alpha','beta'),('beta','alpha')]:
            code,pages,_=request('/ycode/api/pages?is_index=true',user=site,site=site)
            self.assertEqual(code,200)
            homepage=next(p for p in pages['data'] if p['is_index'] and not p['page_folder_id'])
            marker='Published-'+site+'-'+uuid.uuid4().hex[:8]
            layers=[{'id':'body','name':'body','classes':'','children':[
                {'id':str(uuid.uuid4()),'name':'text','classes':'text-4xl','variables':{'text':{
                    'type':'dynamic_rich_text','data':{'content':{'type':'doc','content':[
                        {'type':'paragraph','content':[{'type':'text','text':marker}]}]}}}}}]}]
            code,data,_=request('/ycode/api/layers?page_id='+homepage['id'],'PUT',{'layers':layers},user=site,site=site)
            self.assertEqual(code,200,data)
            code,html,headers=request('/ycode/preview',user=site,site=site)
            self.assertEqual(code,200)
            self.assertIn(marker,html)
            self.assertEqual(request('/ycode/preview',user=other,site=site)[0],403)
            self.assertEqual(request('/ycode/preview',site=site)[0],401)
            before=request('/pages?is_published=eq.true',user=other,schema='site_'+other)[1]
            code,data,_=request('/ycode/api/css/generate','POST',{},user=site,site=site)
            self.assertEqual(code,200,data)
            code,data,_=request('/ycode/api/publish','POST',{'pageIds':[homepage['id']]},user=site,site=site)
            self.assertEqual(code,200,data)
            after=request('/pages?is_published=eq.true',user=other,schema='site_'+other)[1]
            self.assertEqual(before,after,'Publishing changed the other site')
            code,html,headers=request('/',site=site)
            self.assertEqual(code,200)
            self.assertIn(marker,html)
            self.assertNotIn('Published-'+other+'-',html)
            self.assertTrue(any(v in headers.get('Cache-Control','') for v in ['no-store','no-cache']))

    def test_08_assets_private_until_publication(self):
        for site,other in [('alpha','beta'),('beta','alpha')]:
            boundary='coursey'+uuid.uuid4().hex
            marker='Private file '+site+' '+uuid.uuid4().hex
            payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nlibrary\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="private.txt"\r\nContent-Type: text/plain\r\n\r\n'
                f'{marker}\r\n--{boundary}--\r\n').encode()
            code,data,_=request('/ycode/api/files/upload','POST',payload,user=site,site=site,raw=True,
                extra={'Content-Type':'multipart/form-data; boundary='+boundary})
            self.assertEqual(code,200,data)
            asset=data['data'];assetpath=asset['public_url']
            self.assertEqual(request(assetpath,user=site,site=site)[1],marker)
            self.assertEqual(request(assetpath,site=site)[0],404)
            self.assertEqual(request(assetpath,user=other,site=site)[0],404)
            self.assertEqual(request(assetpath,user=other,site=other)[0],404)
            if site=='alpha': self.assertEqual(request(assetpath,user='removed',site=site)[0],404)
            draft_path='website/draft-'+uuid.uuid4().hex+'.txt'
            self.assertEqual(storage('/object/site_'+site+'/'+draft_path,'POST',b'original',user=site)[0],200)
            self.assertEqual(storage('/object/site_'+site+'/'+draft_path,'PUT',b'updated',user=site)[0],200)
            self.assertNotEqual(storage('/object/site_'+site+'/'+draft_path,'PUT',b'attack',user=other)[0],200)
            self.assertEqual(storage('/object/authenticated/site_'+site+'/'+draft_path,user=site)[1],b'updated')
            storage('/object/site_'+site,'DELETE',{'prefixes':[draft_path]},user=other)
            self.assertEqual(storage('/object/authenticated/site_'+site+'/'+draft_path,user=site)[1],b'updated')
            self.assertEqual(storage('/object/site_'+site,'DELETE',{'prefixes':[draft_path]},user=site)[0],200)
            self.assertNotEqual(storage('/object/authenticated/site_'+site+'/'+draft_path,user=site)[0],200)
            # Direct storage APIs must enforce the same boundary, without Next.
            for user in [None,other]:
                self.assertNotEqual(storage('/object/authenticated/site_'+site+'/'+asset['storage_path'],user=user)[0],200)
            self.assertNotEqual(storage('/object/site_'+site+'/'+asset['storage_path'],'PUT',b'overwrite',user=other)[0],200)
            # Guessed asset ID/path cannot authorize metadata replacement in the other schema.
            code,data,_=request('/assets?id=eq.'+asset['id'],'PATCH',{'filename':'stolen'},user=other,schema='site_'+site)
            self.assertEqual(code,204)
            self.assertEqual(request('/assets?id=eq.'+asset['id'],user=site,schema='site_'+site)[1][0]['filename'],asset['filename'])
            # Use native full publication, including its privileged/raw-SQL paths.
            before=request('/assets?is_published=eq.true',user=other,schema='site_'+other)[1]
            code,data,_=request('/ycode/api/publish','POST',{'publishAll':True},user=site,site=site)
            self.assertEqual(code,200,data)
            self.assertEqual(request('/assets?is_published=eq.true',user=other,schema='site_'+other)[1],before)
            self.assertEqual(request(assetpath,site=site)[1],marker)
            self.assertNotEqual(storage('/object/site_'+site+'/'+asset['storage_path'],'PUT',b'overwrite',user=site)[0],200)
            storage('/object/site_'+site,'DELETE',{'prefixes':[asset['storage_path']]},user=site)
            self.assertEqual(request(assetpath,site=site)[1],marker,'Published file was deleted')

    def test_09_cms_values_and_cross_site_relationships(self):
        records={}
        for site in ['alpha','beta']:
            code,data,_=request('/ycode/api/collections','POST',{'name':'CMS '+site},user=site,site=site)
            self.assertEqual(code,201,data)
            collection=data['data']['id']
            code,data,_=request('/ycode/api/collections/'+collection+'/fields','POST',{'name':'Headline','key':'headline','type':'text'},user=site,site=site)
            self.assertEqual(code,201,data)
            field=data['data']['id']
            code,data,_=request('/ycode/api/collections/'+collection+'/items','POST',{'values':{field:'Private CMS '+site}},user=site,site=site)
            self.assertEqual(code,201,data)
            item=data['data']['id']
            records[site]=(collection,field,item)
        for site,other in [('alpha','beta'),('beta','alpha')]:
            collection,field,item=records[other]
            path='/ycode/api/collections/'+collection+'/items/'+item+'/values'
            code,data,_=request(path,user=site,site=site)
            self.assertEqual(code,200,data);self.assertFalse(data['data'])
            before=request('/collection_item_values?item_id=eq.'+item,user=other,schema='site_'+other)[1]
            request(path,'PUT',{field:'attack'},user=site,site=site)
            self.assertEqual(request('/collection_item_values?item_id=eq.'+item,user=other,schema='site_'+other)[1],before)
            # Real FK rejects a field belonging to the other site's schema.
            own_item=records[site][2]
            code,data,_=request('/collection_item_values','POST',{'item_id':own_item,'field_id':field,'value':'forged'},user=site,schema='site_'+site)
            self.assertEqual(code,409,data)
        collection,field,item=records['alpha']
        path='/ycode/api/collections/'+collection+'/items/'+item+'/values'
        self.assertEqual(request(path,'PUT',{field:'Editor CMS change'},user='editor')[0],200)
        self.assertEqual(request(path,'PUT',{field:'Viewer attack'},user='viewer')[0],403)
        values=request('/collection_item_values?item_id=eq.'+item+'&field_id=eq.'+field,user='alpha',schema='site_alpha')[1]
        self.assertEqual(values[0]['value'],'Editor CMS change')
        self.assertEqual(request('/ycode/api/collections/'+collection+'/publish','POST',{},user='editor')[0],403)

    def test_10_admin_boundaries_and_metadata_spoofing(self):
        user=STATE['users']['designer']; outsider=STATE['users']['outsider']
        self.assertEqual(request('/coursey/api/members','PUT',{'user_id':user,'role':'admin'},user='alpha')[0],200)
        try:
            self.assertEqual(request('/coursey/api/context',user='designer')[1]['role'],'admin')
            self.assertEqual(request('/coursey/api/members','PUT',{'user_id':STATE['users']['alpha'],'role':None},user='designer')[0],403)
            self.assertEqual(request('/coursey/api/members','PUT',{'user_id':outsider,'role':'owner'},user='designer')[0],403)
            self.assertEqual(request('/coursey/api/members','PUT',{'user_id':outsider,'role':'viewer'},user='designer')[0],200)
            self.assertEqual(request('/ycode/api/pages',user='outsider')[0],200)
            self.assertEqual(request('/ycode/api/pages',user='outsider',site='beta')[0],403)
            self.assertEqual(request('/coursey/api/members','PUT',{'user_id':outsider,'role':None},user='designer')[0],200)
            self.assertEqual(request('/ycode/api/pages',user='outsider')[0],403)
        finally:
            request('/coursey/api/members','PUT',{'user_id':user,'role':'designer'},user='alpha')
        req=urllib.request.Request('http://127.0.0.1:54329/auth/v1/user',method='PUT',
            data=json.dumps({'data':{'role':'owner','site_id':STATE['sites']['alpha']}}).encode(),
            headers={'apikey':SECRETS['DEV_ANON_KEY'],'Authorization':'Bearer '+TOKENS['outsider'],'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as r:self.assertEqual(r.status,200)
        self.assertEqual(request('/ycode/api/pages',user='outsider')[0],403)
        self.assertEqual(request('/rpc/set_member','POST',{'target':STATE['sites']['alpha'],'member':outsider,'new_role':'owner'},user='outsider',schema='coursey_api')[0],403)
        self.assertEqual(request('/ycode/api/pages',extra={'Authorization':'Bearer forged'})[0],404)
        self.assertEqual(request('/ycode/api/pages','POST',{},user='alpha',extra={'Origin':'http://beta.localhost:3310'})[0],403)

    def test_11_concurrent_site_publication_and_cache_separation(self):
        from concurrent.futures import ThreadPoolExecutor
        markers={site:'Concurrent-'+site+'-'+uuid.uuid4().hex[:8] for site in ['alpha','beta']}
        def publish(site):
            code,data,_=request('/ycode/api/pages?is_index=true',user=site,site=site)
            page=next(p for p in data['data'] if p['is_index'] and not p['page_folder_id'])
            layers=[{'id':'body','name':'body','children':[{'id':str(uuid.uuid4()),'name':'text','variables':{'text':{
                'type':'dynamic_rich_text','data':{'content':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':markers[site]}]}]}}}}}]}]
            self.assertEqual(request('/ycode/api/layers?page_id='+page['id'],'PUT',{'layers':layers},user=site,site=site)[0],200)
            self.assertEqual(request('/ycode/api/css/generate','POST',{},user=site,site=site)[0],200)
            self.assertEqual(request('/ycode/api/publish','POST',{'pageIds':[page['id']]},user=site,site=site)[0],200)
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(publish,['alpha','beta']))
        for repeat in range(3):
            for site,other in [('alpha','beta'),('beta','alpha')]:
                code,html,_=request('/',site=site)
                self.assertEqual(code,200);self.assertIn(markers[site],html);self.assertNotIn(markers[other],html)

    def test_06_unknown_host_and_disabled_surface(self):
        self.assertEqual(request('/ycode/api/pages',user='alpha',site='unknown')[0],404)
        for path in ['/ycode/api/devtools/reset-db','/ycode/api/setup/migrate','/ycode/api/auth/users','/ycode/api/v1/collections','/ycode/mcp','/api/cron/airtable-webhooks','/api/airtable-webhook','/ycode/api/form-submissions']:
            self.assertEqual(request(path,'POST',{},user='alpha')[0],403,path)

if __name__=='__main__':unittest.main(verbosity=2)
