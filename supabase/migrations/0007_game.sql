-- Review stage: adults may swap cells after a draft, before locking
create or replace function assign_cell(p_assignment uuid, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_a assignments; v_w weeks; v_m members;
begin
  select * into v_a from assignments where id = p_assignment;
  if v_a.id is null then raise exception 'cell not found'; end if;
  if not is_adult(v_a.household_id) then raise exception 'adults only'; end if;
  select * into v_w from weeks where id = v_a.week_id for update;
  if v_w.status not in ('SETUP','REVIEW') then raise exception 'this week is not open for changes'; end if;

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

create function start_game(p_week uuid, p_players uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_n int;
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
  update weeks set mode = 'GAME', status = 'DRAFTING', draft_players = p_players where id = p_week;
end $$;

create function clear_board(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'SETUP' then raise exception 'this week is not open for changes'; end if;
  update assignments set member_id = null, source = null where week_id = p_week;
end $$;

-- The escape hatch: abandon a game, or throw away a finished draft
create function cancel_game(p_week uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w weeks;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status not in ('DRAFTING','REVIEW') then raise exception 'there is no game to cancel'; end if;
  update assignments set member_id = null, source = null where week_id = p_week;
  update weeks set status = 'SETUP', mode = 'NORMAL', draft_players = null, draft_order = null,
         turn_index = null, current_member_id = null, turn_deadline = null
   where id = p_week;
end $$;

-- Pass-and-play result: the phone did the drafting, the server re-checks every pick.
-- All or nothing: one bad pick rolls the whole thing back.
create function submit_board(p_week uuid, p_picks jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_w weeks; v_p record; v_a assignments; v_m members; v_n int := 0;
begin
  select * into v_w from weeks where id = p_week for update;
  if v_w.id is null then raise exception 'week not found'; end if;
  if not is_adult(v_w.household_id) then raise exception 'adults only'; end if;
  if v_w.status <> 'DRAFTING' then raise exception 'this week is not being drafted'; end if;
  if jsonb_typeof(p_picks) <> 'array' then raise exception 'bad picks'; end if;

  for v_p in
    select * from jsonb_to_recordset(p_picks) as x(assignment uuid, member uuid, source text)
  loop
    select * into v_a from assignments where id = v_p.assignment and week_id = p_week;
    if v_a.id is null then raise exception 'a cell is not part of this week'; end if;
    if v_a.member_id is not null then raise exception 'cell % was picked twice', v_a.chore_name; end if;
    select * into v_m from members
     where id = v_p.member and household_id = v_w.household_id and id = any (v_w.draft_players);
    if v_m.id is null then raise exception 'that player is not in this game'; end if;
    if v_a.chore_category = 'ADULT_ONLY' and v_m.role = 'CHILD' then
      raise exception 'children cannot take adult-only chores';
    end if;
    update assignments
       set member_id = v_m.id,
           source = case when v_p.source = 'AUTO' then 'AUTO' else 'DRAFT' end
     where id = v_a.id;
    v_n := v_n + 1;
  end loop;

  update weeks set status = 'REVIEW' where id = p_week;
  return v_n;
end $$;

revoke execute on function start_game(uuid, uuid[])  from public, anon;
revoke execute on function clear_board(uuid)         from public, anon;
revoke execute on function cancel_game(uuid)         from public, anon;
revoke execute on function submit_board(uuid, jsonb) from public, anon;
grant execute on function start_game(uuid, uuid[])   to authenticated;
grant execute on function clear_board(uuid)          to authenticated;
grant execute on function cancel_game(uuid)          to authenticated;
grant execute on function submit_board(uuid, jsonb)  to authenticated;

notify pgrst, 'reload schema';