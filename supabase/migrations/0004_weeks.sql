create type week_mode         as enum ('GAME','NORMAL');
create type week_status       as enum ('SETUP','DRAFTING','REVIEW','LOCKED','CLOSED');
create type assignment_status as enum ('OPEN','PENDING','DONE','APPROVED','MISSED','SKIPPED');

create table weeks (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  week_start        date not null,
  mode              week_mode not null default 'NORMAL',
  status            week_status not null default 'SETUP',
  draft_players     uuid[],
  draft_order       uuid[],
  turn_index        int,
  current_member_id uuid references members(id),
  turn_deadline     timestamptz,
  snake             boolean not null default true,
  unique (household_id, week_start)
);

create table assignments (
  id             uuid primary key default gen_random_uuid(),
  week_id        uuid not null references weeks(id) on delete cascade,
  household_id   uuid not null references households(id) on delete cascade,
  chore_id       uuid references chores(id) on delete set null,
  chore_name     text not null,
  chore_effort   smallint not null,
  chore_category chore_category not null,
  date           date not null,
  member_id      uuid references members(id),
  status         assignment_status not null default 'OPEN',
  source         text,
  completed_at   timestamptz,
  approved_by    uuid references members(id),
  points_awarded int not null default 0,
  on_time        boolean,
  unique (week_id, chore_id, date)
);
create index assignments_week_idx   on assignments (week_id);
create index assignments_member_idx on assignments (member_id);

alter table weeks       enable row level security;
alter table assignments enable row level security;

-- Clients can only READ these tables. Every write goes through the functions below.
revoke all on weeks, assignments from anon, authenticated;
grant select on weeks, assignments to authenticated;

create policy "members read weeks" on weeks
  for select using (my_role(household_id) is not null);
create policy "members read assignments" on assignments
  for select using (my_role(household_id) is not null);

create function is_adult(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role(h) in ('HEAD','ADULT'), false)
$$;

-- Household-local week start. offset 0 = this week, 1 = next week.
create function get_week_start(p_household uuid, p_offset int default 0)
returns date language plpgsql stable security definer set search_path = public as $$
declare v_h households; v_local date;
begin
  if my_role(p_household) is null then raise exception 'not a member'; end if;
  if p_offset not between 0 and 1 then raise exception 'offset must be 0 or 1'; end if;
  select * into v_h from households where id = p_household;
  v_local := (now() at time zone v_h.timezone)::date;
  return v_local - ((extract(dow from v_local)::int - v_h.week_start_day + 7) % 7) + p_offset * 7;
end $$;

create function create_week(p_household uuid, p_offset int default 0, p_mode week_mode default 'NORMAL')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_start date; v_week uuid; v_n int;
begin
  if not is_adult(p_household) then raise exception 'adults only'; end if;
  v_start := get_week_start(p_household, p_offset);
  perform pg_advisory_xact_lock(hashtext(p_household::text || v_start::text));

  select id into v_week from weeks where household_id = p_household and week_start = v_start;
  if v_week is not null then return v_week; end if;

  insert into weeks (household_id, week_start, mode)
    values (p_household, v_start, p_mode) returning id into v_week;

  -- one open cell per active chore x active day. Blocked days simply get no row.
  insert into assignments (week_id, household_id, chore_id, chore_name, chore_effort, chore_category, date)
  select v_week, p_household, c.id, c.name, c.effort, c.category, v_start + i
    from chores c
    cross join generate_series(0, 6) as i
   where c.household_id = p_household and c.is_active
     and (extract(isodow from v_start + i)::int - 1)::smallint = any (c.active_days);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no active chores to put on the board'; end if;
  return v_week;
end $$;

create function assign_cell(p_assignment uuid, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_a assignments; v_w weeks; v_m members;
begin
  select * into v_a from assignments where id = p_assignment;
  if v_a.id is null then raise exception 'cell not found'; end if;
  if not is_adult(v_a.household_id) then raise exception 'adults only'; end if;
  select * into v_w from weeks where id = v_a.week_id for update;
  if v_w.status <> 'SETUP' then raise exception 'this week is not open for changes'; end if;

  if p_member is not null then
    select * into v_m from members where id = p_member and household_id = v_a.household_id;
    if v_m.id is null then raise exception 'that person is not in this household'; end if;
    if v_a.chore_category = 'ADULT_ONLY' and v_m.role = 'CHILD' then
      raise exception 'children cannot take adult-only chores';
    end if;
  end if;

  update assignments
     set member_id = p_member,
         source    = case when p_member is null then null else 'MANUAL' end
   where id = p_assignment;
end $$;

create function copy_last_week(p_week uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_prev uuid; v_n int;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'SETUP' then raise exception 'this week is not open for changes'; end if;

  select id into v_prev from weeks
   where household_id = v_w.household_id and week_start < v_w.week_start
   order by week_start desc limit 1;
  if v_prev is null then raise exception 'there is no earlier week to copy'; end if;

  -- fills EMPTY cells only: same chore, same weekday, skipping anything now illegal
  update assignments t
     set member_id = s.member_id, source = 'MANUAL'
    from assignments s
    join members m on m.id = s.member_id
   where t.week_id = p_week and t.member_id is null
     and s.week_id = v_prev and s.member_id is not null
     and s.chore_id = t.chore_id
     and extract(isodow from s.date) = extract(isodow from t.date)
     and not (t.chore_category = 'ADULT_ONLY' and m.role = 'CHILD');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- v1 balancing: hardest chores first, each to the eligible person with the lowest load.
create function suggest_assignments(p_week uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_a record; v_pick uuid; v_n int := 0;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'SETUP' then raise exception 'this week is not open for changes'; end if;

  for v_a in
    select id, chore_category from assignments
     where week_id = p_week and member_id is null
     order by chore_effort desc, random()
  loop
    select m.id into v_pick
      from members m
     where m.household_id = v_w.household_id
       and (v_a.chore_category = 'FAMILY' or m.role in ('HEAD','ADULT'))
     order by (select coalesce(sum(x.chore_effort), 0) from assignments x
                where x.week_id = p_week and x.member_id = m.id), random()
     limit 1;
    if v_pick is not null then
      update assignments set member_id = v_pick, source = 'AUTO' where id = v_a.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create function lock_week(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_open int;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status not in ('SETUP','REVIEW') then raise exception 'week is already %', v_w.status; end if;
  select count(*) into v_open from assignments
   where week_id = p_week and member_id is null and status <> 'SKIPPED';
  if v_open > 0 then raise exception '% cells still need an owner', v_open; end if;
  update assignments set status = 'PENDING' where week_id = p_week and status = 'OPEN';
  update weeks set status = 'LOCKED' where id = p_week;
end $$;

-- Undo a lock, only while nothing has been completed yet
create function reopen_week(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'LOCKED' then raise exception 'week is not locked'; end if;
  if exists (select 1 from assignments where week_id = p_week
              and status in ('DONE','APPROVED','MISSED')) then
    raise exception 'chores have already been completed this week';
  end if;
  update assignments set status = 'OPEN' where week_id = p_week and status = 'PENDING';
  update weeks set status = 'SETUP' where id = p_week;
end $$;

revoke execute on function is_adult(uuid)                       from public, anon;
revoke execute on function get_week_start(uuid, int)            from public, anon;
revoke execute on function create_week(uuid, int, week_mode)    from public, anon;
revoke execute on function assign_cell(uuid, uuid)              from public, anon;
revoke execute on function copy_last_week(uuid)                 from public, anon;
revoke execute on function suggest_assignments(uuid)            from public, anon;
revoke execute on function lock_week(uuid)                      from public, anon;
revoke execute on function reopen_week(uuid)                    from public, anon;
grant execute on function is_adult(uuid)                        to authenticated;
grant execute on function get_week_start(uuid, int)             to authenticated;
grant execute on function create_week(uuid, int, week_mode)     to authenticated;
grant execute on function assign_cell(uuid, uuid)               to authenticated;
grant execute on function copy_last_week(uuid)                  to authenticated;
grant execute on function suggest_assignments(uuid)             to authenticated;
grant execute on function lock_week(uuid)                       to authenticated;
grant execute on function reopen_week(uuid)                     to authenticated;

notify pgrst, 'reload schema';