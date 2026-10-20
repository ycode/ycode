#!/usr/bin/env python3
"""Synthetic-only seed. Does not run against arbitrary or production URLs."""
import json,pathlib,secrets,subprocess,urllib.request
values=dict(l.split('=',1) for l in pathlib.Path('/opt/ccpm/dev-secrets/coursey.env').read_text().splitlines() if '=' in l)
result=pathlib.Path('coursey/test-results');result.mkdir(exist_ok=True)
state={'password':secrets.token_urlsafe(20),'users':{}}
for name in ['alpha','beta','designer','editor','viewer','outsider','removed']:
 req=urllib.request.Request('http://127.0.0.1:54329/auth/v1/admin/users',
  data=json.dumps({'email':name+'@coursey.invalid','password':state['password'],'email_confirm':True}).encode(),
  headers={'Authorization':'Bearer '+values['DEV_SERVICE_KEY'],'apikey':values['DEV_SERVICE_KEY'],'Content-Type':'application/json'})
 with urllib.request.urlopen(req) as r: state['users'][name]=json.load(r)['id']
state['sites']={'alpha':'11111111-1111-4111-8111-111111111111','beta':'22222222-2222-4222-8222-222222222222','alpha_two':'33333333-3333-4333-8333-333333333333'}
sql="INSERT INTO coursey_control.customers(id,name) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic A'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic B');\n"
for site,siteid in state['sites'].items():
 customer='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' if site=='beta' else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 sql+=f"INSERT INTO coursey_control.sites(id,customer_id,name,schema_name) VALUES ('{siteid}','{customer}','{site}','site_{site}');\n"
 host=site.replace('_','-')+'.localhost'
 sql+=f"INSERT INTO coursey_control.domains VALUES ('{host}','{siteid}',true);\n"
 owner='beta' if site=='beta' else 'alpha'
 sql+=f"INSERT INTO coursey_control.memberships VALUES ('{siteid}','{state['users'][owner]}','owner');\n"
for name in ['designer','editor','viewer','removed']:
 role='designer' if name=='removed' else name
 sql+=f"INSERT INTO coursey_control.memberships VALUES ('{state['sites']['alpha']}','{state['users'][name]}','{role}');\n"
command=['docker','compose','--env-file','/opt/ccpm/dev-secrets/coursey.env','-f','coursey/dev/compose.yml','exec','-T','db','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','coursey_dev']
subprocess.run(command,input=sql,text=True,check=True)
fd=__import__('os').open(result/'identities.json',__import__('os').O_CREAT|__import__('os').O_EXCL|__import__('os').O_WRONLY,0o600)
with __import__('os').fdopen(fd,'w') as f: json.dump(state,f)
print('Created seven synthetic Auth users, two customers and three sites; credentials not displayed.')
