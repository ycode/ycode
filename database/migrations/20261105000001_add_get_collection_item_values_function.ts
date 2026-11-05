import type { Knex } from 'knex';

/**
 * Migration: SQL function for bulk collection item value reads.
 *
 * `getValuesByItemIds` is the hottest read in the app (every rendered CMS
 * list, every dynamic page, imports, publishing). It used to go to the
 * database directly over the Postgres wire protocol, which has no
 * compression: each EAV row costs ~260 bytes on the wire, half of it two
 * repeated UUIDs. Returning the same data as one JSON object through
 * PostgREST (`supabase.rpc`) gets gzip for free — roughly 7x fewer bytes —
 * and sidesteps PostgREST's row cap and URL-length limits, which were the
 * reason for the direct-DB path in the first place.
 *
 * Returns `{ "<item_id>": { "<field_id>": "<value>" } }` for the requested
 * items, optionally restricted to a set of field ids. Items with no matching
 * rows are simply absent.
 *
 * SECURITY INVOKER (the default): the service role already bypasses RLS and
 * is the only role allowed to execute it.
 *
 * Idempotent: CREATE OR REPLACE, and the grants are no-ops when repeated.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION get_collection_item_values(
      p_item_ids UUID[],
      p_is_published BOOLEAN DEFAULT FALSE,
      p_field_ids UUID[] DEFAULT NULL
    )
    RETURNS JSONB
    LANGUAGE sql
    STABLE
    SET search_path = public
    AS $$
      SELECT COALESCE(jsonb_object_agg(item_id, fields), '{}'::jsonb)
      FROM (
        SELECT item_id, jsonb_object_agg(field_id, value) AS fields
        FROM collection_item_values
        WHERE item_id = ANY(p_item_ids)
          AND is_published = p_is_published
          AND deleted_at IS NULL
          AND (p_field_ids IS NULL OR field_id = ANY(p_field_ids))
        GROUP BY item_id
      ) per_item;
    $$;
  `);

  // Only the server-side service role may call it. Roles are checked so the
  // migration also runs on databases without the Supabase auth roles.
  await knex.raw(`
    DO $$
    BEGIN
      REVOKE ALL ON FUNCTION get_collection_item_values(UUID[], BOOLEAN, UUID[]) FROM PUBLIC;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON FUNCTION get_collection_item_values(UUID[], BOOLEAN, UUID[]) FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON FUNCTION get_collection_item_values(UUID[], BOOLEAN, UUID[]) FROM authenticated;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION get_collection_item_values(UUID[], BOOLEAN, UUID[]) TO service_role;
      END IF;
    END
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP FUNCTION IF EXISTS get_collection_item_values(UUID[], BOOLEAN, UUID[])');
}
