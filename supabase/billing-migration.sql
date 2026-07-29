-- VERVE INVOICE: PAID SUBSCRIPTION ACCESS
-- Run this in Supabase Dashboard > SQL Editor after the original schema.sql.
-- Safe to run more than once.

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_current_period_end timestamptz;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_id_key
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- This function is the database-level access check used by RLS.
-- Users cannot change the billing/admin columns themselves.
create or replace function public.has_paid_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        is_admin = true
        or (
          subscription_status in ('active', 'trialing')
          and (
            subscription_current_period_end is null
            or subscription_current_period_end > now()
          )
        )
      )
  );
$$;

revoke all on function public.has_paid_access() from public;
grant execute on function public.has_paid_access() to authenticated;

-- Replace data policies so being logged in is not enough; paid/admin access is also required.
drop policy if exists "clients_select_own" on public.clients;
drop policy if exists "clients_insert_own" on public.clients;
drop policy if exists "clients_update_own" on public.clients;
drop policy if exists "clients_delete_own" on public.clients;
drop policy if exists "invoices_select_own" on public.invoices;
drop policy if exists "invoices_insert_own" on public.invoices;
drop policy if exists "invoices_update_own" on public.invoices;
drop policy if exists "invoices_delete_own" on public.invoices;

create policy "clients_select_own"
on public.clients for select
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access());

create policy "clients_insert_own"
on public.clients for insert
to authenticated
with check ((select auth.uid()) = user_id and public.has_paid_access());

create policy "clients_update_own"
on public.clients for update
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access())
with check ((select auth.uid()) = user_id and public.has_paid_access());

create policy "clients_delete_own"
on public.clients for delete
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access());

create policy "invoices_select_own"
on public.invoices for select
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access());

create policy "invoices_insert_own"
on public.invoices for insert
to authenticated
with check ((select auth.uid()) = user_id and public.has_paid_access());

create policy "invoices_update_own"
on public.invoices for update
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access())
with check ((select auth.uid()) = user_id and public.has_paid_access());

create policy "invoices_delete_own"
on public.invoices for delete
to authenticated
using ((select auth.uid()) = user_id and public.has_paid_access());

-- Prevent browser users from changing is_admin or Stripe subscription fields.
revoke insert, update on public.profiles from authenticated;

grant insert (
  id, business_name, contact_name, email, phone, address, city_state_zip,
  website, tax_id, color, invoice_prefix, next_number, payment_terms
) on public.profiles to authenticated;

grant update (
  business_name, contact_name, email, phone, address, city_state_zip,
  website, tax_id, color, invoice_prefix, next_number, payment_terms
) on public.profiles to authenticated;

grant select on public.profiles to authenticated;
