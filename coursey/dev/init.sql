CREATE EXTENSION IF NOT EXISTS pgcrypto;
\getenv dev_password POSTGRES_PASSWORD
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'dev_password';
GRANT anon, authenticated, service_role TO authenticator;
CREATE ROLE supabase_auth_admin LOGIN PASSWORD :'dev_password';
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
   NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
$$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE SCHEMA storage;
CREATE ROLE coursey_runtime LOGIN NOINHERIT PASSWORD :'dev_password';
GRANT anon, authenticated TO coursey_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
