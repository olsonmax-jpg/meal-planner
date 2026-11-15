-- Meal planner schema. Paste into Supabase: SQL Editor > New query > Run.
-- Safe to run once on a fresh project.

-- 1. Who is allowed in
create table if not exists allowed_emails (
  email text primary key
);
insert into allowed_emails (email) values
  ('olson.max@gmail.com'),
  ('phoebe.redlin@gmail.com')
on conflict do nothing;

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from allowed_emails
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2. Tables
create table if not exists categories (
  id serial primary key,
  name text not null unique,
  icon text not null,
  sort int not null default 0
);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category_id int references categories(id) on delete set null,
  source_url text,
  image_url text,
  minutes int,
  servings int,
  notes text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null default 0,
  name text not null,
  quantity text,
  aisle text
);

create table if not exists up_next (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null default 0,
  cooked boolean not null default false,
  added_at timestamptz not null default now()
);

create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity text,
  aisle text not null default 'Other',
  checked boolean not null default false,
  recipe_id uuid references recipes(id) on delete set null,
  added_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- 3. Categories (Teo, not Toddler)
insert into categories (name, icon, sort) values
  ('Asian', 'ramen_dining', 1),
  ('Mexican', 'local_fire_department', 2),
  ('Italian', 'local_pizza', 3),
  ('Comfort food', 'lunch_dining', 4),
  ('Baking', 'bakery_dining', 5),
  ('Salads', 'nutrition', 6),
  ('Teo', 'child_care', 7),
  ('Breakfast', 'egg_alt', 8),
  ('BBQ', 'outdoor_grill', 9)
on conflict (name) do nothing;

-- 4. Row level security: only the two allowed emails can read or write anything
alter table allowed_emails enable row level security;
alter table categories enable row level security;
alter table recipes enable row level security;
alter table ingredients enable row level security;
alter table up_next enable row level security;
alter table shopping_items enable row level security;

create policy "allowed read categories" on categories for select using (is_allowed());
create policy "allowed all recipes" on recipes for all using (is_allowed()) with check (is_allowed());
create policy "allowed all ingredients" on ingredients for all using (is_allowed()) with check (is_allowed());
create policy "allowed all up_next" on up_next for all using (is_allowed()) with check (is_allowed());
create policy "allowed all shopping_items" on shopping_items for all using (is_allowed()) with check (is_allowed());
-- allowed_emails has no policy on purpose: nobody can read or edit it from the app.

-- 5. Live sync between the two phones
alter publication supabase_realtime add table recipes, ingredients, up_next, shopping_items;
