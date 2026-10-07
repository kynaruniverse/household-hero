alter table weeks add column draft_shares jsonb, add column draft_cap_pct int;

-- Fair share per player, same maths as fairShares() in domain/draft.ts
create function compute_shares(p_week uuid, p_players uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_adults int; v_kids int; v_n int;
  v_family numeric; v_adult_only numeric;
  v_base numeric; v_gap numeric; v_al numeric := 0; v_kl numeric := 0;
begin
  select count(*) filter (where role <> 'CHILD'), count(*) filter (where role = 'CHILD')
    into v_adults, v_kids from members where id = any (p_players);
  v_n := v_adults + v_kids;
  select coalesce(sum(chore_effort) filter (where chore_category = 'FAMILY'), 0),
         coalesce(sum(chore_effort) filter (where chore_category = 'ADULT_ONLY'), 0)
    into v_family, v_adult_only from assignments where week_id = p_week;
  if v_adults = 0 then v_adult_only := 0; end if;

  if v_adults > 0 and v_kids > 0 then
    v_base := v_adult_only / v_adults;
    v_gap := v_base * v_kids;
    if v_family <= v_gap then v_al := v_base; v_kl := v_family / v_kids;
    else v_al := v_base + (v_family - v_gap) / v_n; v_kl := v_al; end if;
  elsif v_adults > 0 then v_al := (v_adult_only + v_family) / v_adults;
  elsif v_kids > 0 then v_kl := v_family / v_kids;
  end if;

  return (select jsonb_object_agg(m.id, case when m.role <> 'CHILD' then v_al else v_kl end)
            from members m where m.id = any (p_players));
end $$;

-- Which open cells may this member legally take right now?
create function legal_cells(p_week uuid, p_member uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.id
    from assignments a, weeks w, members m
   where w.id = p_week and a.week_id = w.id and m.id = p_member
     and a.member_id is null
     and (a.chore_category = 'FAMILY' or m.role <> 'CHILD')
     and (select coalesce(sum(x.chore_effort), 0) from assignments x
           where x.week_id = w.id and x.member_id = m.id) + a.chore_effort
         <= coalesce((w.draft_shares ->> m.id::text)::numeric, 0) * w.draft_cap_pct / 100.0 + 0.000000001
$$;

-- Anything the cap blocked goes to the least-loaded eligible player, then the week moves to REVIEW
create function finish_draft(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_a record; v_pick uuid;
begin
  select * into v_w from weeks where id = p_week;
  for v_a in
    select id, chore_category from assignments
     where week_id = p_week and member_id is null order by chore_effort desc, id
  loop
    select m.id into v_pick from members m
     where m.id = any (v_w.draft_players)
       and (v_a.chore_category = 'FAMILY' or m.role <> 'CHILD')
     order by (select coalesce(sum(x.chore_effort), 0) from assignments x
                where x.week_id = p_week and x.member_id = m.id),
              array_position(v_w.draft_players, m.id)
     limit 1;
    if v_pick is not null then
      update assignments set member_id = v_pick, source = 'AUTO' where id = v_a.id;
    end if;
  end loop;
  update weeks set status = 'REVIEW', current_member_id = null, turn_deadline = null where id = p_week;
end $$;

-- Next player in snake order who still has a legal cell (same rule as advance() in TS)
create function advance_turn(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_n int; v_idx int; v_pid uuid; v_step int; v_open int; v_hours int;
begin
  select * into v_w from weeks where id = p_week for update;
  select count(*) into v_open from assignments where week_id = p_week and member_id is null;
  if v_open > 0 then
    v_n := cardinality(v_w.draft_order);
    v_hours := coalesce((select (settings ->> 'turnTimeoutHours')::int
                           from households where id = v_w.household_id), 12);
    for v_step in 1 .. 2 * v_n loop
      v_idx := v_w.turn_index + v_step;
      v_pid := v_w.draft_order[1 + case when (v_idx / v_n) % 2 = 0
                                        then v_idx % v_n
                                        else v_n - 1 - (v_idx % v_n) end];
      if exists (select 1 from legal_cells(p_week, v_pid)) then
        update weeks
           set turn_index = v_idx, current_member_id = v_pid,
               turn_deadline = now() + make_interval(hours => v_hours)
         where id = p_week;
        return;
      end if;
    end loop;
  end if;
  perform finish_draft(p_week);
end $$;

create function start_async_game(p_week uuid, p_players uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_n int; v_order uuid[];
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'SETUP' then raise exception 'this week is not open for changes'; end if;
  if exists (select 1 from assignments where week_id = p_week and member_id is not null) then
    raise exception 'clear the board first';
  end if;
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'pick at least two players'; end if;
  select count(*) into v_n from members
   where household_id = v_w.household_id and id = any (p_players);
  if v_n <> cardinality(p_players) then raise exception 'unknown player'; end if;

  select array_agg(x order by random()) into v_order from unnest(p_players) as x;
  update weeks
     set mode = 'GAME', status = 'DRAFTING', draft_players = p_players, draft_order = v_order,
         turn_index = -1, current_member_id = null,
         draft_shares = compute_shares(p_week, p_players),
         draft_cap_pct = coalesce((select (settings ->> 'loadCapPercent')::int
                                     from households where id = v_w.household_id), 125)
   where id = p_week;
  perform advance_turn(p_week);
end $$;

create function pick_cell(p_assignment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_a assignments; v_w weeks; v_me members;
begin
  select * into v_a from assignments where id = p_assignment;
  if v_a.id is null then raise exception 'cell not found'; end if;
  select * into v_w from weeks where id = v_a.week_id for update;   -- serialises concurrent picks
  select * into v_me from members
   where household_id = v_w.household_id and auth_uid = auth.uid();
  if v_me.id is null then raise exception 'not a member'; end if;
  if v_w.status <> 'DRAFTING' or v_w.draft_order is null then raise exception 'not drafting'; end if;
  if v_w.current_member_id is distinct from v_me.id then raise exception 'not your turn'; end if;
  if p_assignment not in (select legal_cells(v_w.id, v_me.id)) then
    raise exception 'you can''t take that one';
  end if;
  update assignments set member_id = v_me.id, source = 'DRAFT'
   where id = p_assignment and member_id is null;
  if not found then raise exception 'cell already taken'; end if;
  perform advance_turn(v_w.id);
end $$;

create function auto_pick_for(p_week uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_cell uuid; v_share numeric; v_load numeric;
begin
  select * into v_w from weeks where id = p_week;
  v_share := coalesce((v_w.draft_shares ->> p_member::text)::numeric, 0);
  select coalesce(sum(chore_effort), 0) into v_load
    from assignments where week_id = p_week and member_id = p_member;
  select a.id into v_cell from assignments a
   where a.id in (select legal_cells(p_week, p_member))
   order by abs(v_load + a.chore_effort - v_share), random()
   limit 1;
  if v_cell is not null then
    update assignments set member_id = p_member, source = 'AUTO' where id = v_cell;
  end if;
  perform advance_turn(p_week);
end $$;

create function run_expired_turns() returns int
language plpgsql security definer set search_path = public as $$
declare v_w record; v_n int := 0;
begin
  for v_w in
    select id from weeks
     where status = 'DRAFTING' and draft_order is not null and turn_deadline < now()
  loop
    perform 1 from weeks
     where id = v_w.id and status = 'DRAFTING' and turn_deadline < now() for update;
    if found then
      perform auto_pick_for(v_w.id, (select current_member_id from weeks where id = v_w.id));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Now also clears the async fields
create or replace function cancel_game(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status not in ('DRAFTING','REVIEW') then raise exception 'there is no game to cancel'; end if;
  update assignments set member_id = null, source = null where week_id = p_week;
  update weeks set status = 'SETUP', mode = 'NORMAL', draft_players = null, draft_order = null,
         turn_index = null, current_member_id = null, turn_deadline = null,
         draft_shares = null, draft_cap_pct = null
   where id = p_week;
end $$;

create function update_settings(p_household uuid, p_cap int, p_timeout int, p_approval boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  if p_cap not between 100 and 200 then raise exception 'load cap must be between 100 and 200'; end if;
  if p_timeout not between 1 and 72 then raise exception 'turn timeout must be 1 to 72 hours'; end if;
  update households
     set settings = settings || jsonb_build_object(
           'loadCapPercent', p_cap, 'turnTimeoutHours', p_timeout, 'requireApproval', p_approval)
   where id = p_household;
end $$;

-- Internal helpers are never callable from the app
revoke execute on function compute_shares(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function legal_cells(uuid, uuid)      from public, anon, authenticated;
revoke execute on function finish_draft(uuid)           from public, anon, authenticated;
revoke execute on function advance_turn(uuid)           from public, anon, authenticated;
revoke execute on function auto_pick_for(uuid, uuid)    from public, anon, authenticated;
revoke execute on function run_expired_turns()          from public, anon, authenticated;
revoke execute on function start_async_game(uuid, uuid[]) from public, anon;
revoke execute on function pick_cell(uuid)              from public, anon;
revoke execute on function update_settings(uuid, int, int, boolean) from public, anon;
grant execute on function start_async_game(uuid, uuid[]) to authenticated;
grant execute on function pick_cell(uuid)                to authenticated;
grant execute on function update_settings(uuid, int, int, boolean) to authenticated;

-- Live updates
alter publication supabase_realtime add table public.weeks, public.assignments;

-- Auto-pick for timed-out turns, every 5 minutes
select cron.schedule('expire-turns', '*/5 * * * *', $$select run_expired_turns()$$);

notify pgrst, 'reload schema';