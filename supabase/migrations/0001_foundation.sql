create type member_role as enum ('HEAD','ADULT','CHILD');

create table households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_uid      uuid not null references auth.users(id),
  timezone       text not null default 'Europe/London',
  week_start_day smallint not null default 1,
  invite_code    text not null unique,
  reward_note    text,
  settings       jsonb not null default '{"defaultMode":"GAME","requireApproval":true,"turnTimeoutHours":12,"loadCapPercent":125,"quietHoursStart":"21:00","quietHoursEnd":"07:00"}',
  created_at     timestamptz not null default now()
);

create table members (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  auth_uid       uuid references auth.users(id),
  display_name   text not null,
  role           member_role not null,
  avatar         text,
  token_emoji    text,
  token_colour   text,
  join_code      text unique,
  total_points   int not null default 0,
  current_streak int not null default 0,
  best_streak    int not null default 0,
  notif_prefs    jsonb not null default '{}',
  unique (household_id, auth_uid)
);

alter table households enable row level security;
alter table members    enable row level security;

create function my_role(h uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from members where household_id = h and auth_uid = auth.uid()
$$;

create policy "members read household" on households
  for select using (my_role(id) is not null);
create policy "members read members" on members
  for select using (my_role(household_id) is not null);

create function create_household(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_h uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    then raise exception 'adults only'; end if;
  insert into households (name, owner_uid, invite_code)
    values (p_name, auth.uid(), upper(substr(md5(gen_random_uuid()::text), 1, 8)))
    returning id into v_h;
  insert into members (household_id, auth_uid, display_name, role)
    values (v_h, auth.uid(), p_display_name, 'HEAD');
  return v_h;
end $$;

revoke execute on function create_household(text, text) from public, anon;
grant  execute on function create_household(text, text) to authenticated;