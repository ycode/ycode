BEGIN;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO service_role;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT ON storage.buckets TO anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon, authenticated;
CREATE FUNCTION coursey_control.registered_bucket(bucket text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM coursey_control.sites WHERE schema_name::text=$1 AND active)
$$;
REVOKE ALL ON FUNCTION coursey_control.registered_bucket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION coursey_control.registered_bucket(text) TO anon,authenticated;
CREATE POLICY coursey_bucket_metadata ON storage.buckets FOR SELECT
 USING(coursey_control.registered_bucket(id));
COMMIT;
