-- ===== Tuning constants =====
create table scoring_config (id int primary key default 1, config jsonb not null);
insert into scoring_config (id, config) values (1, '{
  "pointsPerEffort": 10, "onTimeBonusPct": 25, "lateFactorPct": 50,
  "earlyBirdBonus": 5, "earlyBirdHour": 9,
  "perfectWeekBonus": 50, "streakThresholdPct": 90
}');
alter table scoring_config enable row level security;   -- no policies: read only by the functions below
revoke all on scoring_config from anon, authenticated;

create or replace function calc_points(p_effort int, p_on_time boolean, p_completed timestamptz, p_tz text)
returns int language plpgsql stable security definer set search_path = public as $$
declare c jsonb; v_base numeric; v_pts int;
begin
  select config into c from scoring_config where id = 1;
  c := coalesce(c, '{}'::jsonb);
  v_base := p_effort * coalesce((c ->> 'pointsPerEffort')::numeric, 10);
  if p_on_time then
    v_pts := round(v_base * (1 + coalesce((c ->> 'onTimeBonusPct')::numeric, 25) / 100))::int;
    if (p_completed at time zone p_tz)::time
         < make_time(coalesce((c ->> 'earlyBirdHour')::int, 9), 0, 0) then
      v_pts := v_pts + coalesce((c ->> 'earlyBirdBonus')::int, 5);
    end if;
  else
    v_pts := round(v_base * coalesce((c ->> 'lateFactorPct')::numeric, 50) / 100)::int;
  end if;
  return v_pts;
end $$;

-- ===== Achievements =====
create table achievements (key text primary key, name text not null, description text not null);
create table member_achievements (
  member_id uuid not null references members(id) on delete cascade,
  key       text not null references achievements(key),
  earned_at timestamptz not null default now(),
  primary key (member_id, key)
);
insert into achievements (key, name, description) values
  ('first_steps',    'First Steps',    'Get your first chore approved'),
  ('early_bird',     'Early Bird',     'Complete 5 chores before 9am'),
  ('bin_boss',       'Bin Boss',       'Do the bins on time 5 weeks in a row'),
  ('perfect_week',   'Perfect Week',   'Finish every chore on time in a week'),
  ('on_a_roll',      'On a Roll',      'Keep a 3-week streak'),
  ('unstoppable',    'Unstoppable',    'Keep a 10-week streak'),
  ('heavy_lifter',   'Heavy Lifter',   'Complete 10 big chores (effort 4 or 5)'),
  ('team_player',    'Team Player',    'Take the most family chores in a week'),
  ('draft_champion', 'Draft Champion', 'Play 10 Game Mode weeks'),
  ('comeback_kid',   'Comeback Kid',   'A perfect week right after a rough one'),
  ('century',        'Century',        'Complete 100 chores');

-- ===== Weekly results (one row per member per closed week) =====
create table week_results (
  week_id      uuid not null references weeks(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  week_start   date not null,
  assigned     int not null,
  on_time      int not null,
  family_count int not null,
  pct          numeric not null,
  points       int not null,        -- approved points + any perfect-week bonus
  bonus        int not null default 0,
  perfect      boolean not null default false,
  hero         boolean not null default false,
  primary key (week_id, member_id)
);
create index week_results_house_idx on week_results (household_id, week_start desc);

alter table achievements        enable row level security;
alter table member_achievements enable row level security;
alter table week_results        enable row level security;
revoke all on achievements, member_achievements, week_results from anon, authenticated;
grant select on achievements, member_achievements, week_results to authenticated;

create policy "everyone reads the catalogue" on achievements for select using (true);
create policy "members read earned" on member_achievements for select
  using (exists (select 1 from members m where m.id = member_id and my_role(m.household_id) is not null));
create policy "members read results" on week_results for select
  using (my_role(household_id) is not null);

-- ===== Achievement checks (server only) =====
create function bin_streak(p_member uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare r record; v_n int := 0; v_prev date;
begin
  for r in
    select w.week_start,
           bool_and(a.status in ('DONE','APPROVED') and coalesce(a.on_time, false)) as ok
      from assignments a join weeks w on w.id = a.week_id
     where a.member_id = p_member and a.chore_name ilike '%bin%'
       and a.status <> 'SKIPPED' and w.status in ('LOCKED','CLOSED')
     group by w.week_start
     order by w.week_start desc
  loop
    if not r.ok then exit; end if;
    if v_prev is not null and v_prev - r.week_start <> 7 then exit; end if;
    v_n := v_n + 1;
    v_prev := r.week_start;
  end loop;
  return v_n;
end $$;

create function evaluate_achievements(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m members; v_tz text; v_hour int; v_done int; v_early int; v_heavy int; v_games int;
begin
  select * into v_m from members where id = p_member;
  if v_m.id is null then return; end if;
  select timezone into v_tz from households where id = v_m.household_id;
  v_hour := coalesce((select (config ->> 'earlyBirdHour')::int from scoring_config where id = 1), 9);

  select count(*),
         count(*) filter (where (completed_at at time zone v_tz)::time < make_time(v_hour, 0, 0)),
         count(*) filter (where chore_effort >= 4)
    into v_done, v_early, v_heavy
    from assignments where member_id = p_member and status = 'APPROVED';

  select count(*) into v_games from weeks
   where mode = 'GAME' and status in ('LOCKED','CLOSED') and p_member = any (draft_players);

  insert into member_achievements (member_id, key)
  select p_member, t.k
    from (values
      ('first_steps',    v_done >= 1),
      ('early_bird',     v_early >= 5),
      ('bin_boss',       bin_streak(p_member) >= 5),
      ('perfect_week',   exists (select 1 from week_results where member_id = p_member and perfect)),
      ('on_a_roll',      v_m.best_streak >= 3),
      ('unstoppable',    v_m.best_streak >= 10),
      ('heavy_lifter',   v_heavy >= 10),
      ('team_player',    exists (
          select 1 from week_results r
           where r.member_id = p_member and r.family_count > 0
             and not exists (select 1 from week_results o
                              where o.week_id = r.week_id and o.member_id <> r.member_id
                                and o.family_count >= r.family_count))),
      ('draft_champion', v_games >= 10),
      ('comeback_kid',   exists (
          select 1 from week_results r
            join week_results prev on prev.member_id = r.member_id and prev.week_start = r.week_start - 7
           where r.member_id = p_member and r.perfect and prev.pct < 50)),
      ('century',        v_done >= 100)
    ) as t(k, ok)
   where t.ok
  on conflict do nothing;
end $$;

-- Points are paid out here, so this is where trophies get checked
create or replace function finalize_assignment(p_assignment uuid, p_approver uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_a assignments; v_tz text; v_pts int;
begin
  select * into v_a from assignments where id = p_assignment for update;
  select timezone into v_tz from households where id = v_a.household_id;
  v_pts := calc_points(v_a.chore_effort, v_a.on_time, v_a.completed_at, v_tz);
  update assignments
     set status = 'APPROVED', approved_by = p_approver, points_awarded = v_pts
   where id = p_assignment;
  update members set total_points = total_points + v_pts where id = v_a.member_id;
  perform evaluate_achievements(v_a.member_id);
  return v_pts;
end $$;

-- ===== Mid-week locking: days already gone are skipped, not marked missed =====
create or replace function lock_week(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_open int; v_today date;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status not in ('SETUP','REVIEW') then raise exception 'week is already %', v_w.status; end if;

  select (now() at time zone timezone)::date into v_today from households where id = v_w.household_id;
  update assignments set status = 'SKIPPED'
   where week_id = p_week and status = 'OPEN' and date < v_today;

  select count(*) into v_open from assignments
   where week_id = p_week and member_id is null and status <> 'SKIPPED';
  if v_open > 0 then raise exception '% cells still need an owner', v_open; end if;

  update assignments set status = 'PENDING' where week_id = p_week and status = 'OPEN';
  update weeks set status = 'LOCKED' where id = p_week;
end $$;

-- ===== Leaderboard =====
create function get_leaderboard(p_household uuid)
returns table (r_member uuid, r_name text, r_emoji text, r_role member_role,
               r_week_pts int, r_total int, r_streak int, r_best int)
language plpgsql stable security definer set search_path = public as $$
declare v_start date;
begin
  if my_role(p_household) is null then raise exception 'not a member'; end if;
  v_start := get_week_start(p_household, 0);
  return query
    select m.id, m.display_name, m.token_emoji, m.role,
           coalesce((select sum(a.points_awarded) from assignments a
                       join weeks w on w.id = a.week_id
                      where a.member_id = m.id and w.household_id = p_household
                        and w.week_start = v_start), 0)::int,
           m.total_points, m.current_streak, m.best_streak
      from members m
     where m.household_id = p_household
     order by 5 desc, m.display_name;
end $$;

-- ===== Weekly rollover =====
create function create_week_core(p_household uuid, p_start date, p_mode week_mode default 'NORMAL')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_week uuid; v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_household::text || p_start::text));
  select id into v_week from weeks where household_id = p_household and week_start = p_start;
  if v_week is not null then return v_week; end if;
  insert into weeks (household_id, week_start, mode)
    values (p_household, p_start, p_mode) returning id into v_week;
  insert into assignments (week_id, household_id, chore_id, chore_name, chore_effort, chore_category, date)
  select v_week, p_household, c.id, c.name, c.effort, c.category, p_start + i
    from chores c cross join generate_series(0, 6) as i
   where c.household_id = p_household and c.is_active
     and (extract(isodow from p_start + i)::int - 1)::smallint = any (c.active_days);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no active chores to put on the board'; end if;
  return v_week;
end $$;

create function run_weekly_rollover() returns int
language plpgsql security definer set search_path = public as $$
declare
  w record; m record; hh record; v_cfg jsonb; v_thr numeric; v_bonus int;
  v_assigned int; v_ontime int; v_family int; v_pts int;
  v_pct numeric; v_perfect boolean; v_closed int := 0; v_today date; v_cur date;
begin
  select config into v_cfg from scoring_config where id = 1;
  v_thr   := coalesce((v_cfg ->> 'streakThresholdPct')::numeric, 90);
  v_bonus := coalesce((v_cfg ->> 'perfectWeekBonus')::int, 50);

  -- 1. Close every finished week, once the last day's late-completion window is over
  for w in
    select wk.id, wk.household_id, wk.week_start
      from weeks wk join households h on h.id = wk.household_id
     where wk.status = 'LOCKED'
       and (now() at time zone h.timezone)::date >= wk.week_start + 8
     order by wk.week_start
  loop
    perform 1 from weeks where id = w.id and status = 'LOCKED' for update;
    if found then
      update assignments set status = 'MISSED' where week_id = w.id and status = 'PENDING';

      for m in select id from members where household_id = w.household_id loop
        select count(*) filter (where status <> 'SKIPPED'),
               count(*) filter (where status in ('DONE','APPROVED') and on_time),
               count(*) filter (where chore_category = 'FAMILY' and status <> 'SKIPPED'),
               coalesce(sum(points_awarded), 0)
          into v_assigned, v_ontime, v_family, v_pts
          from assignments where week_id = w.id and member_id = m.id;

        if v_assigned > 0 then
          v_pct := v_ontime::numeric / v_assigned * 100;
          v_perfect := v_ontime = v_assigned;
          if v_perfect then
            update members set total_points = total_points + v_bonus where id = m.id;
          end if;
          if v_pct >= v_thr then
            update members
               set current_streak = current_streak + 1,
                   best_streak = greatest(best_streak, current_streak + 1)
             where id = m.id;
          else
            update members set current_streak = 0 where id = m.id;
          end if;
          insert into week_results (week_id, household_id, member_id, week_start, assigned,
                                    on_time, family_count, pct, points, bonus, perfect)
          values (w.id, w.household_id, m.id, w.week_start, v_assigned, v_ontime, v_family, v_pct,
                  v_pts + case when v_perfect then v_bonus else 0 end,
                  case when v_perfect then v_bonus else 0 end, v_perfect);
        end if;
      end loop;

      update week_results set hero = true
       where week_id = w.id and points > 0
         and points = (select max(points) from week_results where week_id = w.id);
      update weeks set status = 'CLOSED' where id = w.id;

      for m in select id from members where household_id = w.household_id loop
        perform evaluate_achievements(m.id);
      end loop;
      v_closed := v_closed + 1;
    end if;
  end loop;

  -- 2. Keep boards ready: this week's, and next week's from the last day onwards
  for hh in
    select h.id, h.timezone, h.week_start_day from households h
     where exists (select 1 from weeks x where x.household_id = h.id)
  loop
    v_today := (now() at time zone hh.timezone)::date;
    v_cur := v_today - ((extract(dow from v_today)::int - hh.week_start_day + 7) % 7);
    begin
      perform create_week_core(hh.id, v_cur);
      if v_today >= v_cur + 6 then perform create_week_core(hh.id, v_cur + 7); end if;
    exception when others then
      null;   -- e.g. no active chores yet: skip this household quietly
    end;
  end loop;

  return v_closed;
end $$;

-- Internal only
revoke execute on function bin_streak(uuid)             from public, anon, authenticated;
revoke execute on function evaluate_achievements(uuid)  from public, anon, authenticated;
revoke execute on function create_week_core(uuid, date, week_mode) from public, anon, authenticated;
revoke execute on function run_weekly_rollover()        from public, anon, authenticated;
revoke execute on function get_leaderboard(uuid)        from public, anon;
grant  execute on function get_leaderboard(uuid)        to authenticated;

select cron.schedule('weekly-rollover', '5 * * * *', $$select run_weekly_rollover()$$);

notify pgrst, 'reload schema';