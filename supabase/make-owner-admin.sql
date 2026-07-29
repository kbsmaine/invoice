-- 1. Sign up for your own account on the website first.
-- 2. Replace the email below with the exact email you use to log in.
-- 3. Run this in Supabase Dashboard > SQL Editor.

update public.profiles as p
set is_admin = true
from auth.users as u
where p.id = u.id
  and lower(u.email) = lower('YOUR-EMAIL@example.com');

-- Confirm that exactly your account is marked as owner/admin.
select u.email, p.is_admin, p.subscription_status
from public.profiles as p
join auth.users as u on u.id = p.id
where p.is_admin = true;
