BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
   NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
CREATE SCHEMA IF NOT EXISTS coursey_control;
CREATE SCHEMA IF NOT EXISTS coursey_api;
REVOKE ALL ON SCHEMA coursey_control FROM PUBLIC;
GRANT USAGE ON SCHEMA coursey_control, coursey_api TO anon, authenticated;
CREATE TABLE coursey_control.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL
);
CREATE TABLE coursey_control.sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES coursey_control.customers(id),
 name text NOT NULL, schema_name name NOT NULL UNIQUE,
 active boolean NOT NULL DEFAULT true,
 CHECK (schema_name::text ~ '^site_[a-z0-9_]+$')
);
CREATE TABLE coursey_control.domains (
 hostname text PRIMARY KEY CHECK (hostname = lower(hostname) AND hostname !~ '[:/]'),
 site_id uuid NOT NULL REFERENCES coursey_control.sites(id),
 verified boolean NOT NULL DEFAULT false
);
CREATE TABLE coursey_control.memberships (
 site_id uuid NOT NULL REFERENCES coursey_control.sites(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 role text NOT NULL CHECK (role IN ('owner','admin','designer','editor','viewer')),
 PRIMARY KEY (site_id,user_id)
);
CREATE TABLE coursey_control.platform_admins (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id)
);
-- No direct client grants or permissive policies on control tables.
ALTER TABLE coursey_control.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE coursey_control.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE coursey_control.domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE coursey_control.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE coursey_control.platform_admins ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION coursey_control.site_role(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT m.role FROM coursey_control.memberships m JOIN coursey_control.sites s ON s.id=m.site_id
 WHERE m.site_id=target AND m.user_id=auth.uid() AND s.active
$$;
CREATE FUNCTION coursey_control.allowed(target uuid, capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(CASE capability
 WHEN 'read' THEN coursey_control.site_role(target) IS NOT NULL
 WHEN 'cms' THEN coursey_control.site_role(target) IN ('owner','admin','designer','editor')
 WHEN 'design' THEN coursey_control.site_role(target) IN ('owner','admin','designer')
 WHEN 'members' THEN coursey_control.site_role(target) IN ('owner','admin')
 ELSE false END, false)
$$;
CREATE FUNCTION coursey_api.resolve_site(hostname text)
RETURNS TABLE(id uuid, schema_name name, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT s.id,s.schema_name,coursey_control.site_role(s.id)
 FROM coursey_control.sites s JOIN coursey_control.domains d ON d.site_id=s.id
 WHERE d.hostname=lower($1) AND d.verified AND s.active
$$;
CREATE FUNCTION coursey_api.members(target uuid)
RETURNS TABLE(user_id uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT m.user_id,m.role FROM coursey_control.memberships m
 WHERE m.site_id=target AND coursey_control.allowed(target,'members')
$$;
CREATE FUNCTION coursey_api.set_member(target uuid, member uuid, new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_role text; old_role text;
BEGIN
 -- Serialize changes, including last-owner enforcement.
 PERFORM 1 FROM coursey_control.sites WHERE id=target FOR UPDATE;
 actor_role := coursey_control.site_role(target);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 SELECT role INTO old_role FROM coursey_control.memberships WHERE site_id=target AND user_id=member;
 IF actor_role <> 'owner' AND (old_role='owner' OR new_role='owner') THEN
   RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF old_role='owner' AND new_role IS DISTINCT FROM 'owner' AND
    (SELECT count(*) FROM coursey_control.memberships WHERE site_id=target AND role='owner') <= 1 THEN
   RAISE EXCEPTION 'Last owner cannot be removed' USING ERRCODE='42501'; END IF;
 IF new_role IS NULL THEN
   DELETE FROM coursey_control.memberships WHERE site_id=target AND user_id=member;
 ELSE
   INSERT INTO coursey_control.memberships VALUES(target,member,new_role)
   ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role;
 END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA coursey_api, coursey_control FROM PUBLIC;
GRANT EXECUTE ON FUNCTION coursey_control.site_role(uuid), coursey_control.allowed(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION coursey_api.resolve_site(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION coursey_api.members(uuid), coursey_api.set_member(uuid,uuid,text) TO authenticated;
COMMIT;
