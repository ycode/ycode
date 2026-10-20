/** Operator-only provisioning. Never import this module from the web application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import reviewed from './upstream-migrations.json';
import knexFactory, { type Knex } from 'knex';

const PUBLIC_SETTINGS = ['site_name','site_description','ycode_badge','published_css','published_at',
  'global_canonical_url','favicon_asset_id','web_clip_asset_id','sitemap','robots_txt',
  'timezone','default_locale','text_styles','llms_txt'];
const CMS_TABLES = new Set(['collection_items','collection_item_values']);
const SECRET_TABLES = new Set(['app_settings','api_keys','mcp_tokens','mcp_oauth_clients','mcp_oauth_codes','webhooks','webhook_deliveries','ai_chats','form_submissions','collection_imports']);

async function assertReviewedMigrations() {
  const files=(await fs.readdir('database/migrations')).filter(file=>file.endsWith('.ts')).sort();
  if(JSON.stringify(files)!==JSON.stringify(Object.keys(reviewed.migrations))) throw new Error('Unreviewed upstream migration inventory');
  for(const file of files) {
    const digest=createHash('sha256').update(await fs.readFile(path.join('database/migrations',file))).digest('hex');
    if(digest!==reviewed.migrations[file as keyof typeof reviewed.migrations]) throw new Error('Changed upstream migration requires review');
  }
}

export async function provisionSite(db: ReturnType<typeof knexFactory>, site: {id:string; schema_name:string}) {
  await assertReviewedMigrations();
  if (!/^site_[a-z0-9_]+$/.test(site.schema_name)) throw new Error('Invalid schema');
  await db.transaction(async trx => {
    await trx.raw('CREATE SCHEMA ??', [site.schema_name]);
    await trx.raw('SET LOCAL search_path TO ??, public', [site.schema_name]);
    // All upstream migrations run atomically, before grants. Storage and Auth bootstrap
    // are global and must never run per site. No upstream migration file is modified.
    const files = (await fs.readdir('database/migrations')).filter(f=>f.endsWith('.ts')).sort();
    await trx.schema.createTable('coursey_migrations', t=> {t.text('name').primary();});
    for (const file of files) {
      if (file.includes('create_storage_bucket') || file.includes('bootstrap_user_roles')) continue;
      const migration = await import(path.resolve('database/migrations',file));
      await migration.up(trx);
      await trx('coursey_migrations').insert({ name:file });
    }
    await secureSite(trx,site);
  });
}

export async function secureSite(trx:Knex.Transaction,site:{id:string;schema_name:string}) {
  await assertReviewedMigrations();
  await assertReviewedMigrations();
  const tables = await trx('information_schema.tables').select('table_name')
    .where({ table_schema:site.schema_name,table_type:'BASE TABLE' });
  for (const { table_name:table } of tables) {
    if(!reviewed.tables.includes(table)) throw new Error('Unreviewed site table');
    await trx.raw('REVOKE ALL ON ??.?? FROM PUBLIC, anon, authenticated', [site.schema_name,table]);
    if (table === 'coursey_migrations') continue;
    const existing = await trx('pg_policies').select('policyname').where({ schemaname:site.schema_name,tablename:table });
    for (const { policyname } of existing) await trx.raw('DROP POLICY ?? ON ??.??',[policyname,site.schema_name,table]);
    await trx.raw('ALTER TABLE ??.?? ENABLE ROW LEVEL SECURITY',[site.schema_name,table]);
    await trx.raw('ALTER TABLE ??.?? FORCE ROW LEVEL SECURITY',[site.schema_name,table]);
    const published = await trx('information_schema.columns').where({ table_schema:site.schema_name,table_name:table,column_name:'is_published' }).first();
    const deleted = await trx('information_schema.columns').where({ table_schema:site.schema_name,table_name:table,column_name:'deleted_at' }).first();
    const allowed = (cap:string)=>`coursey_control.allowed('${site.id}'::uuid,'${cap}')`;
    let read = allowed('read');
    if (SECRET_TABLES.has(table)) read='false';
    if (published) read += ` OR (is_published${deleted?' AND deleted_at IS NULL':''})`;
    if (table==='settings') read = `${allowed('design')} OR key IN (${PUBLIC_SETTINGS.map(k=>`'${k}'`).join(',')})`;
    const write = SECRET_TABLES.has(table) ? 'false' : `${allowed(CMS_TABLES.has(table)?'cms':'design')}${published?` AND (NOT is_published OR ${allowed('design')})`:''}${table==='settings'?" AND key NOT IN ('custom_code_head','custom_code_body')":''}`;
    // Disabled page-password feature cannot leak a password through public JSON.
    const safePage = ['pages','page_folders'].includes(table) ? " AND NOT COALESCE((settings #>> '{auth,enabled}')::boolean,false)" : '';
    await trx.raw(`CREATE POLICY coursey_read ON ??.?? FOR SELECT USING (${read})`,[site.schema_name,table]);
    await trx.raw(`CREATE POLICY coursey_insert ON ??.?? FOR INSERT WITH CHECK (${write}${safePage})`,[site.schema_name,table]);
    await trx.raw(`CREATE POLICY coursey_update ON ??.?? FOR UPDATE USING (${write}) WITH CHECK (${write}${safePage})`,[site.schema_name,table]);
    await trx.raw(`CREATE POLICY coursey_delete ON ??.?? FOR DELETE USING (${write})`,[site.schema_name,table]);
    await trx.raw('GRANT SELECT ON ??.?? TO anon, authenticated',[site.schema_name,table]);
    await trx.raw('GRANT INSERT,UPDATE,DELETE ON ??.?? TO authenticated',[site.schema_name,table]);
  }
  await trx.raw('GRANT USAGE ON SCHEMA ?? TO anon,authenticated',[site.schema_name]);
  await trx.raw('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ?? TO authenticated',[site.schema_name]);
  await trx('storage.buckets').insert({ id:site.schema_name,name:site.schema_name,public:false }).onConflict('id').merge({ public:false });
  const ddl = (sql:string,bindings:any[])=>trx.raw(trx.raw(sql,bindings).toString());
  // These policies apply to only this site's bucket. No public file URLs.
  for(const action of ['read','insert','update','delete']) await trx.raw('DROP POLICY IF EXISTS ?? ON storage.objects',[`${site.schema_name}_${action}`]);
  const allowed = `coursey_control.allowed('${site.id}'::uuid,'design')`;
  const liveFile = `EXISTS (SELECT 1 FROM "${site.schema_name}".assets a WHERE a.storage_path=storage.objects.name AND a.is_published AND a.deleted_at IS NULL)`;
  await ddl(`CREATE POLICY ?? ON storage.objects FOR SELECT USING (bucket_id=? AND (coursey_control.allowed(?::uuid,'read') OR ${liveFile}))`,[`${site.schema_name}_read`,site.schema_name,site.id]);
  await ddl(`CREATE POLICY ?? ON storage.objects FOR INSERT WITH CHECK (bucket_id=? AND ${allowed})`,[`${site.schema_name}_insert`,site.schema_name]);
  // Immutable published bytes. Editing requires a new object path + publication.
  for (const op of ['UPDATE','DELETE']) {
    await ddl(`CREATE POLICY ?? ON storage.objects FOR ${op} USING (bucket_id=? AND ${allowed} AND NOT (${liveFile}))${op==='UPDATE'?` WITH CHECK (bucket_id='${site.schema_name}' AND ${allowed} AND NOT (${liveFile}))`:''}`,[`${site.schema_name}_${op.toLowerCase()}`,site.schema_name]);
  }
  await trx.raw("NOTIFY pgrst, 'reload schema'");
}

async function main() {
  if (!process.env.COURSEY_MIGRATION_DATABASE_URL) throw new Error('Operator connection required');
  const db = knexFactory({ client:'pg',connection:process.env.COURSEY_MIGRATION_DATABASE_URL });
  try {
    const command=process.argv[2];
    if(command==='control') {
      await db.raw(await fs.readFile('coursey/migrations/001-control.sql','utf8'));
      await db.raw(await fs.readFile('coursey/migrations/002-storage-grants.sql','utf8'));
    } else if(command==='site'||command==='secure-site') {
      const site=await db('coursey_control.sites').where({ id:process.argv[3] }).first();
      if(!site) throw new Error('Unknown operator-registered site');
      if(command==='site') await provisionSite(db,site);
      else await db.transaction(async trx=>{await trx.raw('SET LOCAL search_path TO ??, public',[site.schema_name]);await secureSite(trx,site);});
    } else throw new Error('Expected control or site <registered id>');
  } finally {await db.destroy();}
}
if(require.main===module) main().catch((error)=> {console.error('Provisioning failed:', error.message);process.exitCode=1;});
