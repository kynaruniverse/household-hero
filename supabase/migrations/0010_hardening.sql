-- 0010: review fixes. Safe to run on a project that already has 0001 to 0009.

-- ===== 1. Table permissions =====
-- RLS already blocks client writes, but the default grants were still there.
-- Everything is revoked, then only SELECT is given back, on named columns.
-- invite_code and owner_uid are left out: members (including children) must not read them.
revoke all on households, members from anon, authenticated;

grant select (id, name, timezone, week_start_day, reward_note, settings, created_at)
  on households to authenticated;
grant select (id, household_id, auth_uid, display_name, role, avatar,
  token_emoji, token_colour, total_points, current_streak, best_streak, notif_prefs)
  on members to authenticated;

-- ===== 2. Join codes: 8 characters instead of 6 =====
create or replace function add_member(
  p_household uuid, p_display_name text, p_role member_role,
  p_token_emoji text default null, p_token_colour text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  if p_role <> 'CHILD' then raise exception 'children are added here, grown-ups join with an invite code'; end if;
  if length(trim(p_display_name)) = 0 then raise exception 'name required'; end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into members (household_id, display_name, role, token_emoji, token_colour,
                       join_code, join_code_expires)
  values (p_household, trim(p_display_name), p_role, p_token_emoji, p_token_colour,
          v_code, now() + interval '7 days');
  return v_code;
end $$;

create or replace function regenerate_join_code(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_code text;
begin
  select household_id into v_h from members where id = p_member and role = 'CHILD';
  if v_h is null or my_role(v_h) is distinct from 'HEAD' then
    raise exception 'not allowed';
  end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  update members
     set join_code = v_code, join_code_expires = now() + interval '7 days', auth_uid = null
   where id = p_member;   -- unlinks the old device
  return v_code;
end $$;

-- ===== 3. Household setup: name, timezone, week start and reward note =====
create function validate_household_prefs(p_timezone text, p_week_start_day int, p_reward_note text)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone';
  end if;
  if p_week_start_day is null or p_week_start_day not between 0 and 6 then
    raise exception 'week start day must be 0 (Sunday) to 6 (Saturday)';
  end if;
  if length(coalesce(p_reward_note, '')) > 140 then
    raise exception 'reward note is too long (140 characters at most)';
  end if;
end $$;

-- Replaces the 2-argument version. The old one has to go, otherwise a call with
-- only two arguments would match both and fail as ambiguous.
drop function if exists create_household(text, text);

create function create_household(
  p_name text, p_display_name text,
  p_timezone text default 'Europe/London',
  p_week_start_day int default 1,
  p_reward_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_name text; v_me text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    then raise exception 'adults only'; end if;
  if exists (select 1 from members where auth_uid = auth.uid()) then
    raise exception 'you already belong to a household';
  end if;
  v_name := trim(coalesce(p_name, ''));
  v_me   := trim(coalesce(p_display_name, ''));
  if length(v_name) not between 1 and 60 then raise exception 'household name must be 1 to 60 characters'; end if;
  if length(v_me)   not between 1 and 40 then raise exception 'your name must be 1 to 40 characters'; end if;
  perform validate_household_prefs(p_timezone, p_week_start_day, p_reward_note);

  insert into households (name, owner_uid, invite_code, timezone, week_start_day, reward_note)
    values (v_name, auth.uid(), upper(substr(md5(gen_random_uuid()::text), 1, 8)),
            p_timezone, p_week_start_day::smallint, nullif(trim(coalesce(p_reward_note, '')), ''))
    returning id into v_h;
  insert into members (household_id, auth_uid, display_name, role)
    values (v_h, auth.uid(), v_me, 'HEAD');
  return v_h;
end $$;

create function update_household(
  p_household uuid, p_name text, p_timezone text, p_week_start_day int, p_reward_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_h households; v_name text;
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  select * into v_h from households where id = p_household for update;
  v_name := trim(coalesce(p_name, ''));
  if length(v_name) not between 1 and 60 then raise exception 'household name must be 1 to 60 characters'; end if;
  perform validate_household_prefs(p_timezone, p_week_start_day, p_reward_note);

  -- Boards are anchored to the week start day, so changing it later would overlap existing weeks.
  if p_week_start_day <> v_h.week_start_day
     and exists (select 1 from weeks where household_id = p_household) then
    raise exception 'the week start day is fixed once the first board exists';
  end if;

  update households
     set name = v_name, timezone = p_timezone, week_start_day = p_week_start_day::smallint,
         reward_note = nullif(trim(coalesce(p_reward_note, '')), '')
   where id = p_household;
end $$;

-- ===== 4. Second grown-up: invite codes =====
-- The code lives on households.invite_code, which clients can no longer read.
-- Only the head sees it, and it is replaced as soon as someone uses it.
create function get_invite_code(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  select invite_code into v_code from households where id = p_household;
  return v_code;
end $$;

create function regenerate_invite_code(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  update households set invite_code = v_code where id = p_household;
  return v_code;
end $$;

create function join_household(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_id uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'children join with the code from their grown-up, on the join screen';
  end if;
  v_name := trim(coalesce(p_display_name, ''));
  if length(v_name) not between 1 and 40 then raise exception 'your name must be 1 to 40 characters'; end if;
  if exists (select 1 from members where auth_uid = auth.uid()) then
    raise exception 'you already belong to a household';
  end if;
  if (select count(*) from join_attempts
       where auth_uid = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many tries, wait a few minutes';
  end if;

  select id into v_h from households where invite_code = upper(trim(coalesce(p_code, '')));

  -- A failed guess returns null instead of raising, because a raised
  -- exception would roll back the attempt we just logged.
  if v_h is null then
    insert into join_attempts (auth_uid) values (auth.uid());
    return null;
  end if;

  insert into members (household_id, auth_uid, display_name, role)
    values (v_h, auth.uid(), v_name, 'ADULT') returning id into v_id;
  update households set invite_code = upper(substr(md5(gen_random_uuid()::text), 1, 8))
   where id = v_h;   -- single use
  return v_id;
end $$;

-- ===== 5. create_week no longer duplicates create_week_core =====
create or replace function create_week(p_household uuid, p_offset int default 0, p_mode week_mode default 'NORMAL')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not is_adult(p_household) then raise exception 'adults only'; end if;
  return create_week_core(p_household, get_week_start(p_household, p_offset), p_mode);
end $$;

-- ===== 6. reopen_week also brings back the days lock_week skipped =====
create or replace function reopen_week(p_week uuid) returns void
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
  -- lock_week turned past days into SKIPPED. They go back to OPEN and are skipped again at the next lock.
  update assignments set status = 'OPEN' where week_id = p_week and status in ('PENDING','SKIPPED');
  update weeks set status = 'SETUP' where id = p_week;
end $$;

-- ===== 7. Weekly results only count approved chores =====
-- A chore that is DONE but not yet approved no longer counts as on time (or toward the
-- perfect-week bonus) when the week closes. If it is approved after the close, the result is re-scored.
create function refresh_week_result(p_week uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status week_status; v_old week_results; v_cfg jsonb; v_thr numeric; v_bonus int;
  v_assigned int; v_ontime int; v_pts int; v_pct numeric; v_perfect boolean; v_new_bonus int;
  r record; v_cur int := 0; v_best int := 0;
begin
  select status into v_status from weeks where id = p_week;
  if v_status is distinct from 'CLOSED' then return; end if;   -- open weeks are scored when they close

  select * into v_old from week_results where week_id = p_week and member_id = p_member for update;
  if not found then return; end if;

  select config into v_cfg from scoring_config where id = 1;
  v_thr   := coalesce((v_cfg ->> 'streakThresholdPct')::numeric, 90);
  v_bonus := coalesce((v_cfg ->> 'perfectWeekBonus')::int, 50);

  select count(*) filter (where status <> 'SKIPPED'),
         count(*) filter (where status = 'APPROVED' and on_time),
         coalesce(sum(points_awarded), 0)
    into v_assigned, v_ontime, v_pts
    from assignments where week_id = p_week and member_id = p_member;
  if v_assigned = 0 then return; end if;

  v_pct := v_ontime::numeric / v_assigned * 100;
  v_perfect := v_ontime = v_assigned;
  -- keep the bonus amount this week was originally scored with, if it had one
  v_new_bonus := case when v_perfect then coalesce(nullif(v_old.bonus, 0), v_bonus) else 0 end;

  update members set total_points = total_points + (v_new_bonus - v_old.bonus) where id = p_member;
  update week_results
     set assigned = v_assigned, on_time = v_ontime, pct = v_pct,
         points = v_pts + v_new_bonus, bonus = v_new_bonus, perfect = v_perfect
   where week_id = p_week and member_id = p_member;

  update week_results set hero = false where week_id = p_week and hero;
  update week_results set hero = true
   where week_id = p_week and points > 0
     and points = (select max(points) from week_results where week_id = p_week);

  -- Streaks depend on every closed week in order, so they are rebuilt from the results.
  for r in select pct from week_results where member_id = p_member order by week_start loop
    if r.pct >= v_thr then
      v_cur := v_cur + 1;
      v_best := greatest(v_best, v_cur);
    else
      v_cur := 0;
    end if;
  end loop;
  update members set current_streak = v_cur, best_streak = greatest(best_streak, v_best)
   where id = p_member;
end $$;

revoke execute on function refresh_week_result(uuid, uuid) from public, anon, authenticated;
revoke execute on function validate_household_prefs(text, int, text) from public, anon, authenticated;

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
  -- This update takes the member's row lock, which also keeps the re-score below
  -- from racing the weekly rollover.
  update members set total_points = total_points + v_pts where id = v_a.member_id;
  perform refresh_week_result(v_a.week_id, v_a.member_id);
  perform evaluate_achievements(v_a.member_id);
  return v_pts;
end $$;

create or replace function run_weekly_rollover() returns int
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
    -- Wait for any completion or approval still in flight, so the scores below include it.
    -- Anything approved after the close is handled by refresh_week_result.
    perform 1 from assignments where week_id = w.id and status in ('PENDING','DONE') for update;
    perform 1 from weeks where id = w.id and status = 'LOCKED' for update;
    if found then
      update assignments set status = 'MISSED' where week_id = w.id and status = 'PENDING';

      for m in select id from members where household_id = w.household_id loop
        -- Only APPROVED chores count as on time. DONE means "waiting for a grown-up".
        select count(*) filter (where status <> 'SKIPPED'),
               count(*) filter (where status = 'APPROVED' and on_time),
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

-- ===== 8. Cron: the "daily-misses" job ran hourly, so it is renamed =====
do $$
begin
  perform cron.unschedule('daily-misses');
exception when others then
  null;   -- not there (fresh project): nothing to rename
end $$;
select cron.schedule('hourly-misses', '15 * * * *', $$select run_daily_misses()$$);

-- ===== 9. Grants for the new functions =====
revoke execute on function create_household(text, text, text, int, text) from public, anon;
revoke execute on function update_household(uuid, text, text, int, text) from public, anon;
revoke execute on function get_invite_code(uuid)                          from public, anon;
revoke execute on function regenerate_invite_code(uuid)                   from public, anon;
revoke execute on function join_household(text, text)                     from public, anon;
grant execute on function create_household(text, text, text, int, text) to authenticated;
grant execute on function update_household(uuid, text, text, int, text) to authenticated;
grant execute on function get_invite_code(uuid)                          to authenticated;
grant execute on function regenerate_invite_code(uuid)                   to authenticated;
grant execute on function join_household(text, text)                     to authenticated;

notify pgrst, 'reload schema';
