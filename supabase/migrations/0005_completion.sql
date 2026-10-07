create function household_today(p_household uuid) returns date
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  if my_role(p_household) is null then raise exception 'not a member'; end if;
  select timezone into v_tz from households where id = p_household;
  return (now() at time zone v_tz)::date;
end $$;

create function calc_points(p_effort int, p_on_time boolean, p_completed timestamptz, p_tz text)
returns int language sql stable set search_path = public as $$
  select case
    when p_on_time then
      round(p_effort * 10 * 1.25)::int
      + case when (p_completed at time zone p_tz)::time < time '09:00' then 5 else 0 end
    else round(p_effort * 10 * 0.5)::int
  end
$$;

-- Internal only: marks APPROVED and pays out. Never callable from the app.
create function finalize_assignment(p_assignment uuid, p_approver uuid)
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
  return v_pts;
end $$;

create function complete_assignment(p_assignment uuid, p_client_completed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a assignments; v_me members; v_h households;
  v_at timestamptz; v_local date; v_on_time boolean; v_deadline time; v_pts int;
begin
  select * into v_a from assignments where id = p_assignment for update;
  if v_a.id is null then raise exception 'chore not found'; end if;
  select * into v_me from members where id = v_a.member_id and auth_uid = auth.uid();
  if v_me.id is null then raise exception 'this is not your chore'; end if;

  -- Replays from the offline outbox must be harmless
  if v_a.status in ('DONE','APPROVED') then
    return jsonb_build_object('status', v_a.status, 'points', v_a.points_awarded);
  end if;
  if v_a.status not in ('PENDING','MISSED') then raise exception 'this chore is not open yet'; end if;

  select * into v_h from households where id = v_a.household_id;

  -- Clock trust: accept the phone's time only if sane, otherwise use the server's
  v_at := now();
  if p_client_completed_at is not null
     and p_client_completed_at <= now()
     and p_client_completed_at >= now() - interval '48 hours'
     and (p_client_completed_at at time zone v_h.timezone)::date >= v_a.date
  then v_at := p_client_completed_at; end if;

  v_local := (v_at at time zone v_h.timezone)::date;
  if v_local < v_a.date     then raise exception 'this chore is not due yet'; end if;
  if v_local > v_a.date + 1 then raise exception 'too late, this chore was missed'; end if;

  select deadline_time into v_deadline from chores where id = v_a.chore_id;
  v_on_time := v_local = v_a.date
    and (v_deadline is null or (v_at at time zone v_h.timezone)::time <= v_deadline);

  update assignments set status = 'DONE', completed_at = v_at, on_time = v_on_time
   where id = p_assignment;

  if v_me.role <> 'CHILD'
     or not coalesce((v_h.settings ->> 'requireApproval')::boolean, true) then
    v_pts := finalize_assignment(p_assignment, null);
    return jsonb_build_object('status', 'APPROVED', 'points', v_pts);
  end if;
  return jsonb_build_object('status', 'DONE', 'points', 0);
end $$;

create function approve_assignment(p_assignment uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_a assignments; v_me members;
begin
  select * into v_a from assignments where id = p_assignment for update;
  if v_a.id is null then raise exception 'chore not found'; end if;
  if not is_adult(v_a.household_id) then raise exception 'adults only'; end if;
  select * into v_me from members
   where household_id = v_a.household_id and auth_uid = auth.uid();
  if v_a.status = 'APPROVED' then return v_a.points_awarded; end if;
  if v_a.status <> 'DONE' then raise exception 'nothing to approve'; end if;
  if v_a.member_id = v_me.id then raise exception 'you can''t approve your own chore'; end if;
  return finalize_assignment(p_assignment, v_me.id);
end $$;

create function run_daily_misses() returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update assignments a set status = 'MISSED'
    from households h
   where a.household_id = h.id and a.status = 'PENDING'
     and a.date <= (now() at time zone h.timezone)::date - 2;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function household_today(uuid)   from public, anon;
revoke execute on function calc_points(int, boolean, timestamptz, text) from public, anon;
revoke execute on function finalize_assignment(uuid, uuid) from public, anon, authenticated;
revoke execute on function complete_assignment(uuid, timestamptz) from public, anon;
revoke execute on function approve_assignment(uuid) from public, anon;
revoke execute on function run_daily_misses()      from public, anon, authenticated;
grant execute on function household_today(uuid)    to authenticated;
grant execute on function complete_assignment(uuid, timestamptz) to authenticated;
grant execute on function approve_assignment(uuid) to authenticated;

notify pgrst, 'reload schema';