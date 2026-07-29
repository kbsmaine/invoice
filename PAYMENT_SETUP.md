# Verve Invoice — Stripe Subscription Setup

This build locks invoice and client data unless the logged-in account either:

- has `is_admin = true`, or
- has a Stripe subscription whose status is `active` or `trialing`.

The lock is enforced by Supabase Row Level Security, not only by the website interface.

## 1. Update the database

If you already ran the older `supabase/schema.sql`, run this file in **Supabase → SQL Editor**:

```text
supabase/billing-migration.sql
```

For a brand-new database, run the updated `supabase/schema.sql`; it already includes the billing migration.

## 2. Make your own login free

1. Sign up for your own account on the website.
2. Open `supabase/make-owner-admin.sql`.
3. Replace `YOUR-EMAIL@example.com` with your exact login email.
4. Run it in **Supabase → SQL Editor**.
5. Confirm the final query shows only your intended owner account with `is_admin = true`.

Do not add an email bypass to `app.js`. The admin flag belongs in the database so visitors cannot edit the browser code and unlock themselves.

## 3. Create the Stripe subscription price

In Stripe, create:

- one Product, such as **Verve Invoice Pro**
- one recurring monthly Price, such as **$19.00 USD/month**

Copy the Price ID beginning with `price_`.

The amount displayed on the website is controlled by these non-secret values in `config.js`:

```js
PLAN_NAME: 'Pro',
PLAN_PRICE_DOLLARS: 19
```

The amount actually charged is controlled by the Stripe Price ID. Keep both values matched.

## 4. Add Supabase Edge Function secrets

Add these in **Supabase → Edge Functions → Secrets**, or with the Supabase CLI:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_replace_me
supabase secrets set STRIPE_PRICE_ID=price_replace_me
supabase secrets set APP_URL=https://yourdomain.com/invoice/
```

`APP_URL` must be the exact deployed page where `index.html` loads. It can include a GitHub Pages repository path.

Do not place the Stripe secret key, webhook signing secret, Supabase service-role key, or Supabase secret key in `config.js`, `app.js`, or GitHub.

## 5. Deploy the Edge Functions

From the project folder, while linked to your Supabase project:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```

The included `supabase/config.toml` also disables JWT verification only for `stripe-webhook`. Checkout and portal functions still require a logged-in Supabase user.

## 6. Add the Stripe webhook

In Stripe Workbench/Webhooks, add this endpoint:

```text
https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook
```

Subscribe it to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Copy the endpoint signing secret beginning with `whsec_`, then add it to Supabase:

```bash
supabase secrets set STRIPE_WEBHOOK_SIGNING_SECRET=whsec_replace_me
```

The webhook is what tells Supabase that payment succeeded, failed, was canceled, or expired. A successful browser redirect alone never unlocks an account.

## 7. Enable Stripe Customer Portal

In Stripe, configure the Customer Portal so customers can update cards, view invoices, and cancel or manage their subscription. The app's **Manage subscription** button opens that portal.

## 8. Test before going live

Use Stripe test mode first:

1. Create a new non-owner account.
2. Confirm it reaches the subscription paywall.
3. Complete Checkout with a Stripe test card.
4. Return to the app and click **Refresh access** if needed.
5. Confirm invoices and clients unlock.
6. Cancel through the Customer Portal and confirm the webhook updates access.
7. Confirm your owner/admin account never asks for payment.

When tests pass, replace the test-mode Stripe secret and Price ID with live-mode values and create a live-mode webhook endpoint/signing secret.

## Important behavior

- New accounts are unpaid by default.
- Your account is free only after `is_admin` is set in Supabase.
- Customers cannot change their own admin or Stripe fields because column permissions block those changes.
- RLS prevents unpaid users from reading or writing client and invoice rows, even if they modify the website JavaScript.
