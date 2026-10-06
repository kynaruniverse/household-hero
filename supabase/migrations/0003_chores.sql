create type chore_category as enum ('FAMILY','ADULT_ONLY');

create table chores (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  name              text not null check (length(trim(name)) between 1 and 60),
  icon              text,
  category          chore_category not null default 'FAMILY',
  effort            smallint not null check (effort between 1 and 5),
  active_days       smallint[] not null
    check (cardinality(active_days) between 1 and 7
           and active_days <@ array[0,1,2,3,4,5,6]::smallint[]),   -- 0=Mon .. 6=Sun
  deadline_time     time,
  estimated_minutes int,
  is_active         boolean not null default true
);
create index chores_household_idx on chores (household_id);

alter table chores enable row level security;

revoke all on chores from anon;
grant select, insert, update, delete on chores to authenticated;

create policy "members read chores" on chores
  for select using (my_role(household_id) is not null);
create policy "adults add chores" on chores
  for insert with check (my_role(household_id) in ('HEAD','ADULT'));
create policy "adults edit chores" on chores
  for update using (my_role(household_id) in ('HEAD','ADULT'))
  with check (my_role(household_id) in ('HEAD','ADULT'));
create policy "adults delete chores" on chores
  for delete using (my_role(household_id) in ('HEAD','ADULT'));

create function add_starter_chores(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if my_role(p_household) is null or my_role(p_household) = 'CHILD' then
    raise exception 'adults only';
  end if;
  if exists (select 1 from chores where household_id = p_household) then
    raise exception 'you already have chores';
  end if;
  insert into chores (household_id, name, icon, category, effort, active_days) values
    (p_household, 'Bins',           '🗑️', 'FAMILY'::chore_category,     2, '{6}'::smallint[]),
    (p_household, 'Wash up',        '🍽️', 'FAMILY'::chore_category,     2, '{0,1,2,3,4,5,6}'::smallint[]),
    (p_household, 'Cook tea',       '🍳', 'FAMILY'::chore_category,     3, '{0,1,2,3,4}'::smallint[]),
    (p_household, 'Hoovering',      '🧹', 'FAMILY'::chore_category,     3, '{2,5}'::smallint[]),
    (p_household, 'Laundry',        '🧺', 'FAMILY'::chore_category,     3, '{0,3}'::smallint[]),
    (p_household, 'Tidy bedroom',   '🛏️', 'FAMILY'::chore_category,     1, '{5}'::smallint[]),
    (p_household, 'Clean bathroom', '🚿', 'ADULT_ONLY'::chore_category, 4, '{5}'::smallint[]),
    (p_household, 'Food shop',      '🛒', 'ADULT_ONLY'::chore_category, 4, '{4}'::smallint[]);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function add_starter_chores(uuid) from public, anon;
grant  execute on function add_starter_chores(uuid) to authenticated;