/** Run against a disposable Postgres database: TEST_DATABASE_URL=... ts-node ... */
import assert from 'node:assert/strict';
import knexFactory, { type Knex } from 'knex';
import { up, down } from '@/database/migrations/20261007000001_create_css_variables_system';

export async function verifyCssVariableMigration(db: Knex): Promise<void> {
  await db.schema.createTable('color_variables', table => {
    table.uuid('id').primary(); table.string('name'); table.string('value', 50);
    table.integer('sort_order'); table.timestamp('created_at'); table.timestamp('updated_at');
  });
  const id = '11111111-1111-4111-8111-111111111111';
  await db('color_variables').insert({ id, name: 'Brand', value: '#ff0000/50', sort_order: 2, created_at: new Date(), updated_at: new Date() });
  await up(db);
  assert.equal((await db('css_variables').where({ id }).first()).name, 'Brand');
  assert.equal((await db('css_variable_values').where({ css_variable_id: id }).first()).value, '#ff0000/50');
  assert.equal((await db('color_variables')).length, 1);
  assert.equal((await db('color_variables').where({ id }).first()).value, '#ff0000/50', 'older deployments retain their original colors');
  assert.equal((await db('color_variables').where({ id }).first()).css_variable_migrated, true);
  const mode = await db('css_variable_set_modes').first();
  await db('css_variable_values').where({ css_variable_id: id }).update({ value: '#00ff00' });
  await up(db);
  assert.equal((await db('css_variable_sets')).length, 1);
  assert.equal((await db('css_variable_values').where({ css_variable_id: id }).first()).value, '#00ff00');
  const [collection] = await db('css_variable_sets').insert({ name: 'Spacing' }).returning('*');
  assert.equal((await db('css_variable_set_modes').where({ set_id: collection.id })).length, 1);
  assert.equal((await db('css_variable_groups').where({ set_id: collection.id })).length, 1);
  const [variable] = await db('css_variables').insert({ set_id: collection.id, type: 'size', name: 'Small' }).returning('*');
  assert.ok(variable.group_id, 'ungrouped create receives its default group');
  await assert.rejects(db.transaction(trx => trx('css_variable_values').insert({ css_variable_id: variable.id, mode_id: mode.id, value: '1rem' })), /same collection/);
  const group = await db('css_variable_groups').where({ set_id: collection.id }).first();
  await assert.rejects(db.transaction(trx => trx('css_variables').where({ id }).update({ group_id: group.id })), /belong to its collection/);
  await assert.rejects(db.transaction(trx => trx('css_variable_set_modes').insert({ set_id: collection.id, name: 'Second default', is_default: true })), /unique|duplicate/i);
  const ownMode = await db('css_variable_set_modes').where({ set_id: collection.id }).first();
  const [alias] = await db('css_variables').insert({ set_id: collection.id, type: 'size', name: 'Alias' }).returning('*');
  await db('css_variable_values').insert({ css_variable_id: alias.id, mode_id: ownMode.id, value: `var(--${variable.id})` });
  await assert.rejects(db.transaction(trx => trx('css_variable_values').insert({ css_variable_id: variable.id, mode_id: ownMode.id, value: `var(--${alias.id})` })), /cycle/);
  await assert.rejects(db.transaction(trx => trx('css_variable_set_modes').where({ id: ownMode.id }).delete()), /default mode/);
  await db('css_variable_sets').where({ id: collection.id }).delete();
  assert.equal((await db('css_variables').where({ set_id: collection.id })).length, 0, 'collection deletion cascades');
  // A later old template import still migrates its new colors without replacing existing ones.
  const secondId = '22222222-2222-4222-8222-222222222222';
  await db('color_variables').insert({ id: secondId, name: 'Imported', value: '#ffffff', sort_order: 3 });
  await up(db);
  assert.equal((await db('css_variables')).length, 2);
  await db('css_variables').where({ id: secondId }).delete();
  await up(db);
  assert.equal((await db('css_variables').where({ id: secondId })).length, 0, 'rerun cannot resurrect deleted colors');
  // Project/template imports disable triggers while restoring their own child IDs.
  const tables = ['css_variable_sets', 'css_variable_set_modes', 'css_variable_groups', 'css_variables', 'css_variable_values'];
  const snapshot = await Promise.all(tables.map(table => db(table).select('*')));
  await db.transaction(async trx => {
    await trx.raw('SET LOCAL session_replication_role = replica');
    await trx.raw(`TRUNCATE ${tables.join(', ')} CASCADE`);
    for (const [index, table] of tables.entries()) {
      if (snapshot[index].length) await trx(table).insert(snapshot[index]);
    }
    await trx.raw('SET LOCAL session_replication_role = DEFAULT');
  });
  assert.equal((await db('css_variable_set_modes')).length, snapshot[1].length, 'restore does not provision duplicate default modes');
  assert.equal((await db('css_variable_values').where({ css_variable_id: id }).first()).value, '#00ff00');
  await down(db);
  assert.equal((await db('color_variables').where({ id }).first()).value, '#00ff00');
  assert.equal(await db.schema.hasTable('css_variables'), false);
  console.log('CSS variable migration: preservation, reruns, imports, constraints and rollback passed');
}

if (require.main === module) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable database');
  const db = knexFactory({ client: 'pg', connection: process.env.TEST_DATABASE_URL });
  const schema = `css_variables_test_${Date.now()}`;
  db.transaction(async trx => {
    await trx.raw(`CREATE SCHEMA ${schema}`);
    await trx.raw(`SET LOCAL search_path TO ${schema}, public`);
    await verifyCssVariableMigration(trx);
    throw new Error('ROLLBACK_TEST');
  }).catch(error => {
    if (error.message !== 'ROLLBACK_TEST') { console.error(error); process.exitCode = 1; }
  }).finally(() => db.destroy());
}
