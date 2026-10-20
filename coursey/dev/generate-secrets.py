#!/usr/bin/env python3
"""Generate only development secrets outside source. Refuse to replace a file."""
import base64, hashlib, hmac, json, os, pathlib, secrets, time, sys, tempfile
path = pathlib.Path('/opt/ccpm/dev-secrets/coursey.env')
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
rotate = sys.argv[1:] == ['--rotate-api']
previous = dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line) if rotate else {}
secret = secrets.token_hex(32)
def token(role):
 def b64(value): return base64.urlsafe_b64encode(value).rstrip(b'=')
 header = b64(json.dumps({'alg':'HS256','typ':'JWT'}).encode())
 payload = b64(json.dumps({'role':role,'iss':'coursey-development','iat':int(time.time()),'exp':int(time.time())+86400*365}).encode())
 data = header+b'.'+payload
 return (data+b'.'+b64(hmac.new(secret.encode(),data,hashlib.sha256).digest())).decode()
values = {'DEV_DATABASE_PASSWORD':previous.get('DEV_DATABASE_PASSWORD',secrets.token_hex(24)),'DEV_JWT_SECRET':secret,
          'DEV_ANON_KEY':token('anon'),'DEV_SERVICE_KEY':token('service_role')}
if rotate:
 fd, temporary = tempfile.mkstemp(dir=path.parent)
 with os.fdopen(fd,'w') as f:
  for key,value in values.items(): f.write(key+'='+value+'\n')
 os.replace(temporary,path)
else:
 with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:
  for key,value in values.items(): f.write(key+'='+value+'\n')
print('Development API keys generated; no values displayed.')
