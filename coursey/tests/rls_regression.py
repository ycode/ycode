#!/usr/bin/env python3
"""Replace the audit counterexample with assertions on fully migrated Ycode tables.

The operator test harness SET ROLEs to ordinary API roles; tests never grant
production access or treat PostgreSQL's superuser as a customer identity.
Real JWT/HTTP tests live in http_isolation.py.
"""
import json,pathlib,subprocess,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
STATE=json.loads((ROOT/'coursey/test-results/identities.json').read_text())


def sql(query,login='postgres',ok=True):
    result=subprocess.run(['docker','compose','--env-file','/opt/ccpm/dev-secrets/coursey.env','-f',str(ROOT/'coursey/dev/compose.yml'),
        'exec','-T','db','psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',login,'-d','coursey_dev'],
        input=query,text=True,capture_output=True)
    if ok and result.returncode:raise AssertionError(result.stderr)
    return result


class Policies(unittest.TestCase):
    def test_runtime_is_not_privileged(self):
        self.assertEqual(sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('coursey_runtime','authenticated','anon') AND (rolsuper OR rolbypassrls)").stdout.strip(),'0')
        self.assertNotEqual(sql('SET ROLE service_role;',login='coursey_runtime',ok=False).returncode,0)
        self.assertNotEqual(sql('SELECT * FROM coursey_control.memberships;',login='coursey_runtime',ok=False).returncode,0)
        self.assertNotEqual(sql('CREATE TABLE public.unauthorized(id int);',login='coursey_runtime',ok=False).returncode,0)

    def test_every_native_table_has_replacement_rls(self):
        result=sql("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('site_alpha','site_beta','site_alpha_two') AND c.relkind='r'
          AND c.relname<>'coursey_migrations' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)""")
        self.assertEqual(result.stdout.strip(),'0')
        self.assertEqual(sql("SELECT count(*) FROM pg_policies WHERE schemaname LIKE 'site_%' AND policyname NOT LIKE 'coursey_%'").stdout.strip(),'0')
        self.assertEqual(sql("SELECT count(*) FROM storage.buckets WHERE id LIKE 'site_%' AND public").stdout.strip(),'0')

    def test_bidirectional_cross_client_read_update_delete_insert_denied(self):
        for actor,target in [('alpha','beta'),('beta','alpha')]:
            commands=f"BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{STATE['users'][actor]}',true);\n"
            # Actual schemas/constraints/policies, not the audit's minimal fixtures.
            for table in ['pages','page_folders','page_layers','assets','asset_folders','collections','collection_fields','collection_items','collection_item_values','components','locales','translations','global_variables']:
                commands+=f"""DO $$ DECLARE n int; BEGIN
 IF (SELECT count(*) FROM site_{target}.{table} WHERE NOT is_published) <> 0 THEN RAISE EXCEPTION 'Cross-site draft read'; END IF;
 DELETE FROM site_{target}.{table} WHERE NOT is_published;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-site delete'; END IF;
END $$;\n"""
            commands+=f"""DO $$ DECLARE n int; BEGIN
 UPDATE site_{target}.pages SET name='cross-site-write' WHERE NOT is_published;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-site update'; END IF;
 BEGIN
 INSERT INTO site_{target}.pages(name,slug,is_published) VALUES('Forbidden','forbidden',false);
 RAISE EXCEPTION 'Cross-site insert succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$; ROLLBACK;"""
            sql(commands)

    def test_cross_schema_foreign_keys_fail(self):
        # Parent IDs in another site's schema cannot satisfy native Ycode FKs.
        commands="""BEGIN;
INSERT INTO site_beta.page_folders(id,name,slug,is_published) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other private folder','other',false);
SET LOCAL ROLE authenticated;
"""+f"SELECT set_config('request.jwt.claim.sub','{STATE['users']['alpha']}',true);"+"""
DO $$ BEGIN
 BEGIN
 INSERT INTO site_alpha.pages(name,slug,page_folder_id,is_published)
 VALUES('Forged parent','forged','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
 RAISE EXCEPTION 'Cross-site parent accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$; ROLLBACK;
"""
        sql(commands)

    def test_unreviewed_features_cannot_be_activated_through_rest_tables(self):
        for actor in ['alpha','beta']:
            result=sql(f"""BEGIN;SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','{STATE['users'][actor]}',true);
SELECT count(*) FROM site_{actor}.webhooks;
SELECT count(*) FROM site_{actor}.app_settings;
ROLLBACK;""")
            self.assertEqual(result.stdout.strip().splitlines()[-2:],['0','0'])

if __name__=='__main__':unittest.main(verbosity=2)
