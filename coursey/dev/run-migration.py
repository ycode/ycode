#!/usr/bin/env python3
"""Run the migration CLI only on the isolated development network."""
import os,pathlib,subprocess,sys
values=dict(line.strip().split('=',1) for line in pathlib.Path('/opt/ccpm/dev-secrets/coursey.env').read_text().splitlines() if '=' in line)
env=os.environ.copy()
env['COURSEY_MIGRATION_DATABASE_URL']='postgres://postgres:'+values['DEV_DATABASE_PASSWORD']+'@db:5432/coursey_dev'
args=['docker','run','--rm','--network','coursey-ycode-dev_default','--user','1000:1000',
 '--env','COURSEY_MIGRATION_DATABASE_URL','--env','NODE_OPTIONS=--conditions=react-server',
 '--env','TS_NODE_TRANSPILE_ONLY=1','--env','TS_NODE_PROJECT=tsconfig.test.json',
 '-v',str(pathlib.Path(__file__).resolve().parents[2])+':/workspace:z','-w','/workspace',
 'node:22-bookworm','node','--require','ts-node/register','--require','tsconfig-paths/register','coursey/provision.ts',*sys.argv[1:]]
raise SystemExit(subprocess.run(args,env=env).returncode)
