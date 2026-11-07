-- SANDIKALE POS shared database foundation
-- Apply this migration in the Supabase SQL Editor for project twholneoqjifuaauztri.
-- No existing device/localStorage data is modified by this script.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null default '',
  role text not null default 'kasir' check (role in ('admin','kasir')),
  phone text,
  avatar text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  sku text,
  barcode text,
  name text not null,
  category text,
  cost_price numeric not null default 0,
  selling_price numeric not null default 0,
  stock numeric not null default 0,
  min_stock numeric not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  invoice_number text,
  status text not null default 'completed',
  shift_id text,
  customer_name text,
  grand_total numeric not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id text primary key,
  cashier_id text,
  shift_number text,
  status text not null default 'open',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_settings (
  id bigint primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Create a profile automatically when a staff account is registered through Supabase Auth.
create or replace function public.sandikale_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, name, role, phone)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    'kasir',
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists sandikale_auth_user_created on auth.users;
create trigger sandikale_auth_user_created
after insert on auth.users
for each row execute function public.sandikale_create_profile();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.shifts enable row level security;
alter table public.store_settings enable row level security;

-- Initial staff policy: signed-in SANDIKALE accounts share the same store data.
-- Anonymous/public access is not granted.
do $$
declare t text;
begin
  foreach t in array array['profiles','products','orders','shifts','store_settings']
  loop
    execute format('drop policy if exists "SANDIKALE staff access" on public.%I', t);
    execute format(
      'create policy "SANDIKALE staff access" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Enable Supabase Realtime for tables used by the POS sync engine.
do $$
declare t text;
begin
  foreach t in array array['products','orders','shifts','store_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

