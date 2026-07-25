-- VERVE INVOICE CLOUD DATABASE
-- Run this entire file in Supabase Dashboard > SQL Editor.
-- Designed for Supabase Auth + Postgres Row Level Security.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default 'My Business',
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city_state_zip text not null default '',
  website text not null default '',
  tax_id text not null default '',
  color text not null default '#4f7cff',
  invoice_prefix text not null default 'INV-',
  next_number integer not null default 1001 check (next_number > 0),
  payment_terms text not null default 'Payment is due by the date shown above. Thank you for your business.',
  plan text not null default 'pro' check (plan in ('starter', 'pro', 'agency')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city_state_zip text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid,
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date not null default (current_date + 14),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax_rate numeric(8,3) not null default 0 check (tax_rate >= 0),
  notes text not null default '',
  terms text not null default '',
  lines jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_client_owner_fk
    foreign key (client_id, user_id)
    references public.clients(id, user_id)
    on delete restrict,
  unique (user_id, invoice_number)
);

create index if not exists clients_user_id_idx on public.clients(user_id);
create index if not exists invoices_user_id_idx on public.invoices(user_id);
create index if not exists invoices_client_id_idx on public.invoices(client_id);
create index if not exists invoices_due_date_idx on public.invoices(due_date);

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.invoices enable row level security;

-- Remove old policies with these names so the script can be safely rerun.
drop policy if exists "profile_select_own" on public.profiles;
drop policy if exists "profile_insert_own" on public.profiles;
drop policy if exists "profile_update_own" on public.profiles;
drop policy if exists "clients_select_own" on public.clients;
drop policy if exists "clients_insert_own" on public.clients;
drop policy if exists "clients_update_own" on public.clients;
drop policy if exists "clients_delete_own" on public.clients;
drop policy if exists "invoices_select_own" on public.invoices;
drop policy if exists "invoices_insert_own" on public.invoices;
drop policy if exists "invoices_update_own" on public.invoices;
drop policy if exists "invoices_delete_own" on public.invoices;

create policy "profile_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "profile_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profile_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "clients_select_own"
on public.clients for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "clients_insert_own"
on public.clients for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "clients_update_own"
on public.clients for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "clients_delete_own"
on public.clients for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "invoices_select_own"
on public.invoices for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "invoices_insert_own"
on public.invoices for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "invoices_update_own"
on public.invoices for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "invoices_delete_own"
on public.invoices for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Authenticated users need table privileges; RLS still limits rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    business_name,
    contact_name,
    email
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'business_name', ''), 'My Business'),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
