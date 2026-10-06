alter table members add column join_code_expires timestamptz;

-- Stop the app reading join codes (otherwise one child could see a sibling's code)
revoke select on members from anon, authenticated;
grant select (id, household_id, auth_uid, display_name, role, avatar,
  token_emoji, token_colour, total_points, current_streak, best_streak, notif_prefs)
  on members to authenticated;

create table join_attempts (
  id       bigint generated always as identity primary key,
  auth_uid uuid not null,
  at       timestamptz not null default now()
);
alter table join_attempts enable row level security;  -- no policies = no client access

create function add_member(
  p_household uuid, p_display_name text, p_role member_role,
  p_token_emoji text default null, p_token_colour text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  if p_role <> 'CHILD' then raise exception 'only child profiles for now'; end if;
  if length(trim(p_display_name)) = 0 then raise exception 'name required'; end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into members (household_id, display_name, role, token_emoji, token_colour,
                       join_code, join_code_expires)
  values (p_household, trim(p_display_name), p_role, p_token_emoji, p_token_colour,
          v_code, now() + interval '7 days');
  return v_code;
end $$;

create function regenerate_join_code(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_h uuid; v_code text;
begin
  select household_id into v_h from members where id = p_member and role = 'CHILD';
  if v_h is null or my_role(v_h) is distinct from 'HEAD' then
    raise exception 'not allowed';
  end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  update members
     set join_code = v_code, join_code_expires = now() + interval '7 days', auth_uid = null
   where id = p_member;   -- unlinks the old device
  return v_code;
end $$;

create function get_join_codes(p_household uuid)
returns table (member_id uuid, code text)
language plpgsql security definer set search_path = public as $$
begin
  if my_role(p_household) is distinct from 'HEAD' then raise exception 'head only'; end if;
  return query
    select m.id, m.join_code from members m
     where m.household_id = p_household and m.join_code is not null
       and (m.join_code_expires is null or m.join_code_expires > now());
end $$;

create function claim_join_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'use the join screen on the child''s own device';
  end if;
  if (select count(*) from join_attempts
       where auth_uid = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many tries, wait a few minutes';
  end if;

  update members
     set auth_uid = auth.uid(), join_code = null, join_code_expires = null
   where join_code = upper(trim(p_code))
     and role = 'CHILD' and auth_uid is null
     and (join_code_expires is null or join_code_expires > now())
  returning id into v_id;

  -- A failed guess returns null instead of raising, because a raised
  -- exception would roll back the attempt we just logged.
  if v_id is null then insert into join_attempts (auth_uid) values (auth.uid()); end if;
  return v_id;
end $$;

revoke execute on function add_member(uuid, text, member_role, text, text) from public, anon;
revoke execute on function regenerate_join_code(uuid) from public, anon;
revoke execute on function get_join_codes(uuid)       from public, anon;
revoke execute on function claim_join_code(text)      from public, anon;
grant execute on function add_member(uuid, text, member_role, text, text) to authenticated;
grant execute on function regenerate_join_code(uuid) to authenticated;
grant execute on function get_join_codes(uuid)       to authenticated;
grant execute on function claim_join_code(text)      to authenticated;