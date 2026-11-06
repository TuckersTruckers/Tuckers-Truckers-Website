-- The submit-website-inquiry Edge Function uses insert(...).select('id') and updates notification status.
-- Keep these grants limited to service_role; do not expose inquiry rows to anon or authenticated.
GRANT SELECT, UPDATE ON TABLE public.website_inquiries TO service_role;
