VERVE INVOICE — CLOUD DATABASE BUILD

This version uses Supabase Auth and Supabase Postgres instead of storing invoice/customer data in the browser.

START HERE
1. Read SETUP.md.
2. Create a Supabase project.
3. Run supabase/schema.sql in the Supabase SQL Editor.
4. Paste the Project URL and publishable/anon key into config.js.
5. Upload the files to your website.

IMPORTANT
- Do not use the service_role key in the website.
- Host the site through HTTPS for production.
- The app intentionally shows a database setup screen instead of a blank page when config.js is not filled in.
