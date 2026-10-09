import type { Knex } from 'knex';

/**
 * Migration: CSS Variables System
 *
 * Extends the color-only variable system into a typed CSS variable system
 * supporting multiple types (color, size, percentage, number, font_family),
 * variable sets with multiple modes (theme via data-theme, breakpoint via
 * @media), and optional groups.
 *
 * Existing color_variables rows are migrated into a default "Colors" set with
 * a single default mode. IDs are preserved so existing `var(--<uuid>)`
 * references in layer classes/design continue to resolve.
 */

export async function up(knex: Knex): Promise<void> {
  // css_variable_sets
  if (!(await knex.schema.hasTable('css_variable_sets'))) {
    await knex.schema.createTable('css_variable_sets', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.string('name', 255).notNullable();
      table.string('activation_kind', 32).notNullable().defaultTo('default');
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE css_variable_sets
      ADD CONSTRAINT css_variable_sets_activation_kind_check
      CHECK (activation_kind IN ('default','theme','breakpoint'))
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_css_variable_sets_sort
      ON css_variable_sets(sort_order, created_at)
    `);

    await knex.raw('ALTER TABLE css_variable_sets ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY "CSS variable sets are viewable"
        ON css_variable_sets FOR SELECT USING (true)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can insert CSS variable sets"
        ON css_variable_sets FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can update CSS variable sets"
        ON css_variable_sets FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can delete CSS variable sets"
        ON css_variable_sets FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
  }

  // css_variable_set_modes
  if (!(await knex.schema.hasTable('css_variable_set_modes'))) {
    await knex.schema.createTable('css_variable_set_modes', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table
        .uuid('set_id')
        .notNullable()
        .references('id')
        .inTable('css_variable_sets')
        .onDelete('CASCADE');
      table.string('name', 255).notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.string('data_theme', 255).nullable();
      table.integer('min_width').nullable();
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_css_variable_set_modes_set_sort
      ON css_variable_set_modes(set_id, sort_order, created_at)
    `);

    await knex.raw('ALTER TABLE css_variable_set_modes ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY "CSS variable set modes are viewable"
        ON css_variable_set_modes FOR SELECT USING (true)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can insert CSS variable set modes"
        ON css_variable_set_modes FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can update CSS variable set modes"
        ON css_variable_set_modes FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can delete CSS variable set modes"
        ON css_variable_set_modes FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
  }

  // css_variable_groups
  if (!(await knex.schema.hasTable('css_variable_groups'))) {
    await knex.schema.createTable('css_variable_groups', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table
        .uuid('set_id')
        .notNullable()
        .references('id')
        .inTable('css_variable_sets')
        .onDelete('CASCADE');
      table.string('name', 255).notNullable();
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_css_variable_groups_set_sort
      ON css_variable_groups(set_id, sort_order, created_at)
    `);

    await knex.raw('ALTER TABLE css_variable_groups ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY "CSS variable groups are viewable"
        ON css_variable_groups FOR SELECT USING (true)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can insert CSS variable groups"
        ON css_variable_groups FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can update CSS variable groups"
        ON css_variable_groups FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can delete CSS variable groups"
        ON css_variable_groups FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
  }

  // css_variables
  if (!(await knex.schema.hasTable('css_variables'))) {
    await knex.schema.createTable('css_variables', (table) => {
      table.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table
        .uuid('set_id')
        .notNullable()
        .references('id')
        .inTable('css_variable_sets')
        .onDelete('CASCADE');
      table
        .uuid('group_id')
        .nullable()
        .references('id')
        .inTable('css_variable_groups')
        .onDelete('SET NULL');
      table.string('type', 32).notNullable();
      table.string('name', 255).notNullable();
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });

    await knex.raw(`
      ALTER TABLE css_variables
      ADD CONSTRAINT css_variables_type_check
      CHECK (type IN ('color','size','percentage','number','font_family'))
    `);

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_css_variables_set_sort
      ON css_variables(set_id, sort_order, created_at)
    `);

    await knex.raw('ALTER TABLE css_variables ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY "CSS variables are viewable"
        ON css_variables FOR SELECT USING (true)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can insert CSS variables"
        ON css_variables FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can update CSS variables"
        ON css_variables FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can delete CSS variables"
        ON css_variables FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
  }

  // css_variable_values
  if (!(await knex.schema.hasTable('css_variable_values'))) {
    await knex.schema.createTable('css_variable_values', (table) => {
      table
        .uuid('css_variable_id')
        .notNullable()
        .references('id')
        .inTable('css_variables')
        .onDelete('CASCADE');
      table
        .uuid('mode_id')
        .notNullable()
        .references('id')
        .inTable('css_variable_set_modes')
        .onDelete('CASCADE');
      table.text('value').notNullable().defaultTo('');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.primary(['css_variable_id', 'mode_id']);
    });

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_css_variable_values_mode
      ON css_variable_values(mode_id)
    `);

    await knex.raw('ALTER TABLE css_variable_values ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY "CSS variable values are viewable"
        ON css_variable_values FOR SELECT USING (true)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can insert CSS variable values"
        ON css_variable_values FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can update CSS variable values"
        ON css_variable_values FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
    await knex.raw(`
      CREATE POLICY "Authenticated users can delete CSS variable values"
        ON css_variable_values FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL)
    `);
  }

  // Provision collection children atomically, including creates through the API.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION provision_css_variable_collection() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO css_variable_set_modes (set_id, name, is_default, sort_order)
      VALUES (NEW.id, 'Default', true, 0);
      INSERT INTO css_variable_groups (set_id, name, sort_order)
      VALUES (NEW.id, 'Default group', 0);
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS provision_css_variable_collection ON css_variable_sets;
    CREATE TRIGGER provision_css_variable_collection AFTER INSERT ON css_variable_sets
    FOR EACH ROW EXECUTE FUNCTION provision_css_variable_collection();
  `);

  // Keep legacy rows available to older deployments sharing this database.
  // A marker prevents replay from resurrecting deleted tokens or overwriting edits.
  if (await knex.schema.hasTable('color_variables')) {
    if (!(await knex.schema.hasColumn('color_variables', 'css_variable_migrated'))) {
      await knex.schema.alterTable('color_variables', table => {
        table.boolean('css_variable_migrated').notNullable().defaultTo(false);
      });
    }
    const rows = await knex('color_variables').select('id', 'name', 'value', 'sort_order', 'created_at', 'updated_at')
      .where('css_variable_migrated', false).whereNotIn('id', knex('css_variables').select('id')).orderBy('sort_order', 'asc');
    if (rows.length) {
      let collection = await knex('css_variable_sets').where({ name: 'Colors', activation_kind: 'default' }).first();
      if (!collection) [collection] = await knex('css_variable_sets').insert({ name: 'Colors', activation_kind: 'default' }).returning('*');
      const mode = await knex('css_variable_set_modes').where({ set_id: collection.id, is_default: true }).first();
      const group = await knex('css_variable_groups').where({ set_id: collection.id }).orderBy('sort_order').first();
      await knex('css_variables').insert(rows.map(row => ({
        id: row.id, set_id: collection.id, group_id: group.id, type: 'color', name: row.name,
        sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at,
      })));
      await knex('css_variable_values').insert(rows.map(row => ({ css_variable_id: row.id, mode_id: mode.id, value: row.value })));
    }
    await knex('color_variables').whereIn('id', knex('css_variables').select('id')).update({ css_variable_migrated: true });
  }

  // Backfill: every set must have at least one group, and no variable may be
  // ungrouped. Create a "Default group" for sets that lack one (idempotent —
  // skipped when any group already exists), then reassign orphan variables.
  await knex.raw(`
    INSERT INTO css_variable_groups (set_id, name, sort_order)
    SELECT s.id, 'Default group', 0
    FROM css_variable_sets s
    WHERE NOT EXISTS (
      SELECT 1 FROM css_variable_groups g WHERE g.set_id = s.id
    )
  `);

  await knex.raw(`
    UPDATE css_variables v
    SET group_id = (
      SELECT g.id FROM css_variable_groups g
      WHERE g.set_id = v.set_id
      ORDER BY g.sort_order ASC, g.created_at ASC
      LIMIT 1
    )
    WHERE v.group_id IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS css_variable_one_default_mode
    ON css_variable_set_modes (set_id) WHERE is_default;
    CREATE INDEX IF NOT EXISTS css_variables_group_id ON css_variables(group_id);
    CREATE OR REPLACE FUNCTION guard_css_variable_relationships() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE target_id uuid; source_type text; target_type text;
    BEGIN
      IF TG_TABLE_NAME = 'css_variables' THEN
        IF NOT EXISTS (SELECT 1 FROM css_variable_sets WHERE id = NEW.set_id) THEN RETURN NEW; END IF;
        IF NEW.group_id IS NULL THEN
          SELECT id INTO NEW.group_id FROM css_variable_groups WHERE set_id = NEW.set_id ORDER BY sort_order, created_at LIMIT 1;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM css_variable_groups WHERE id = NEW.group_id AND set_id = NEW.set_id) THEN
          RAISE EXCEPTION 'Variable group must belong to its collection';
        END IF;
      ELSE
        PERFORM pg_advisory_xact_lock(22161007);
        IF NOT EXISTS (SELECT 1 FROM css_variables v JOIN css_variable_set_modes m ON v.set_id = m.set_id
          WHERE v.id = NEW.css_variable_id AND m.id = NEW.mode_id) THEN
          RAISE EXCEPTION 'Variable and mode must belong to the same collection';
        END IF;
        IF NEW.value ~ '^var\\(--[a-fA-F0-9-]+\\)$' THEN
          target_id := substring(NEW.value from '^var\\(--([a-fA-F0-9-]+)\\)$')::uuid;
          SELECT type INTO source_type FROM css_variables WHERE id = NEW.css_variable_id;
          SELECT type INTO target_type FROM css_variables WHERE id = target_id;
          IF target_type IS NULL OR source_type != target_type THEN RAISE EXCEPTION 'Alias must reference the same variable type'; END IF;
          IF EXISTS (
            WITH RECURSIVE edges AS (
              SELECT css_variable_id AS source, substring(value from '^var\\(--([a-fA-F0-9-]+)\\)$')::uuid AS target
              FROM css_variable_values WHERE value ~ '^var\\(--[a-fA-F0-9-]+\\)$'
                AND NOT (css_variable_id = NEW.css_variable_id AND mode_id = NEW.mode_id)
              UNION ALL SELECT NEW.css_variable_id, target_id
            ), reachable(id) AS (
              SELECT target_id UNION SELECT edges.target FROM edges JOIN reachable ON edges.source = reachable.id
            ) SELECT 1 FROM reachable WHERE id = NEW.css_variable_id
          ) THEN RAISE EXCEPTION 'Variable aliases cannot form a cycle'; END IF;
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_css_variable_group ON css_variables;
    CREATE TRIGGER guard_css_variable_group BEFORE INSERT OR UPDATE ON css_variables
    FOR EACH ROW EXECUTE FUNCTION guard_css_variable_relationships();
    DROP TRIGGER IF EXISTS guard_css_variable_mode ON css_variable_values;
    CREATE TRIGGER guard_css_variable_mode BEFORE INSERT OR UPDATE ON css_variable_values
    FOR EACH ROW EXECUTE FUNCTION guard_css_variable_relationships();
    CREATE OR REPLACE FUNCTION guard_css_variable_default_mode() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.is_default AND EXISTS (SELECT 1 FROM css_variable_sets WHERE id = OLD.set_id) THEN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The default mode cannot be deleted'; END IF;
        IF NOT NEW.is_default THEN RAISE EXCEPTION 'The default mode cannot be unset'; END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_css_variable_default_mode ON css_variable_set_modes;
    CREATE TRIGGER guard_css_variable_default_mode BEFORE UPDATE OR DELETE ON css_variable_set_modes
    FOR EACH ROW EXECUTE FUNCTION guard_css_variable_default_mode();
  `);

}

export async function down(knex: Knex): Promise<void> {
  // Restore the current default colors before removing the typed schema.
  if (await knex.schema.hasTable('color_variables')) {
    await knex.raw(`INSERT INTO color_variables (id, name, value, sort_order, created_at, updated_at)
      SELECT v.id, v.name, val.value, v.sort_order, v.created_at, v.updated_at
      FROM css_variables v JOIN css_variable_set_modes m ON m.set_id = v.set_id AND m.is_default
      JOIN css_variable_values val ON val.css_variable_id = v.id AND val.mode_id = m.id
      WHERE v.type = 'color'
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, value = EXCLUDED.value, sort_order = EXCLUDED.sort_order`);
  }
  if (await knex.schema.hasColumn('color_variables', 'css_variable_migrated')) {
    await knex.schema.alterTable('color_variables', table => table.dropColumn('css_variable_migrated'));
  }
  await knex.schema.dropTableIfExists('css_variable_values');
  await knex.schema.dropTableIfExists('css_variables');
  await knex.schema.dropTableIfExists('css_variable_groups');
  await knex.schema.dropTableIfExists('css_variable_set_modes');
  await knex.schema.dropTableIfExists('css_variable_sets');
  await knex.raw('DROP FUNCTION IF EXISTS guard_css_variable_relationships(); DROP FUNCTION IF EXISTS provision_css_variable_collection(); DROP FUNCTION IF EXISTS guard_css_variable_default_mode();');
}
