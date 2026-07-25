# Verve Invoice — Supabase Cloud Setup

This build stores business profiles, clients, invoices, and invoice line items in Supabase Postgres. Supabase Auth handles passwords and login sessions. Row Level Security (RLS) restricts every database row to the authenticated owner.

## 1. Create the database

1. Create a new Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Open `supabase/schema.sql` from this package.
4. Copy the complete SQL file into the editor and click **Run**.

The script creates:

- `profiles`
- `clients`
- `invoices`
- indexes
- signup profile trigger
- owner-only RLS policies

## 2. Connect the website

In Supabase, open **Project Settings → API** and copy:

- Project URL
- Publishable key, or the legacy anon key

Open `config.js` and replace the placeholders:

```js
window.VERVE_INVOICE_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_OR_ANON_KEY'
};
```

The publishable/anon key is intended for browser applications. Security comes from Auth plus RLS.

**Never place the `service_role` key in `config.js`, GitHub, or any browser file.** It bypasses RLS and must remain server-only.

## 3. Configure authentication URLs

In Supabase, open **Authentication → URL Configuration**.

Set **Site URL** to the final website address, for example:

```text
https://yourdomain.com/
```

Add the exact deployed address under **Redirect URLs**. For a GitHub project page, include the repository path, for example:

```text
https://username.github.io/verve-invoice/
```

Email confirmation can remain enabled. New customers will receive a confirmation link before their first login. You can disable confirmation while privately testing, but enabling it is recommended for launch.

## 4. Deploy

Upload these files and folders together:

```text
index.html
styles.css
app.js
config.js
supabase/
SETUP.md
```

The website can be hosted on GitHub Pages, Netlify, Vercel, Cloudflare Pages, or a regular web host.

Do not test production authentication by double-clicking `index.html`. Use the deployed HTTPS address. For local testing, start a local server inside the folder:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Add `http://localhost:8000` to Supabase Redirect URLs while testing locally.

## What is and is not stored in the browser

Business profiles, clients, invoices, and line items are stored in Supabase—not browser storage. Supabase keeps a login session token in the browser so users stay signed in. That token is not the invoice database and does not contain all customer records.

## Security already included

- Passwords are handled by Supabase Auth and are never written to the public tables.
- RLS is enabled on every application table.
- A user can select, insert, update, and delete only rows whose `user_id` matches their authenticated user ID.
- An invoice can reference only a client belonging to the same user.
- Invoice numbers are unique within each user account.
- The service-role key is not needed by the website.

## Before selling subscriptions

The database and user accounts are ready for a real multi-user MVP. Before a public paid launch, also add:

- Stripe Checkout and server-side webhook verification
- password-reset UI
- terms of service and privacy policy
- support email and account-deletion process
- backups and Supabase security-advisor review
- transactional email for sending invoices to customers

Stripe secret keys and webhook secrets must be used only in a server or Supabase Edge Function, never in `app.js` or `config.js`.
