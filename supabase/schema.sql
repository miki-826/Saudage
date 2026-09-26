-- Run once in the Supabase SQL Editor. All browser access is denied by RLS.
-- Only server-side service_role can access device-owned saves.
create table if not exists public.game_sessions (
  id uuid primary key,
  owner_hash text not null,
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'playing',
  overall_progress integer not null default 0 check(overall_progress between 0 and 100),
  state jsonb not null,
  token text not null
);
create index if not exists game_sessions_owner_idx on public.game_sessions(owner_hash,updated_at desc);
create table if not exists public.memory_states (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  memory_id text not null,
  progress integer not null check(progress between 0 and 100),
  stage integer not null check(stage between 0 and 3),
  unlocked boolean not null,
  updated_at timestamptz not null default now(),
  unique(session_id,memory_id)
);
create table if not exists public.personality_states (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  identity integer not null,
  emotion integer not null,
  trust integer not null,
  connection integer not null
);
alter table public.game_sessions enable row level security;
alter table public.memory_states enable row level security;
alter table public.personality_states enable row level security;
revoke all on public.game_sessions,public.memory_states,public.personality_states from anon,authenticated;
grant all on public.game_sessions,public.memory_states,public.personality_states to service_role;

create or replace function public.save_live_session(p_id uuid,p_owner text,p_state jsonb,p_token text)
returns void language plpgsql security invoker set search_path = public as $$
declare m jsonb; p integer; emotional integer; relationship integer;
begin
  if exists(select 1 from game_sessions where id=p_id and owner_hash<>p_owner) then
    raise exception 'Owner mismatch';
  end if;
  select round(avg((value->>'progress')::numeric)) into p from jsonb_array_elements(p_state->'memories');
  select round(avg((value->>'progress')::numeric)) into emotional from jsonb_array_elements(p_state->'memories') where value->>'id' in ('complaint','regular');
  select (value->>'progress')::int into relationship from jsonb_array_elements(p_state->'memories') where value->>'id'='regular';
  insert into game_sessions(id,owner_hash,state,token,status,overall_progress)
    values(p_id,p_owner,p_state,p_token,case when (p_state->>'completed')::boolean then 'completed' else 'playing' end,p)
    on conflict(id) do update set state=excluded.state,token=excluded.token,status=excluded.status,overall_progress=excluded.overall_progress,updated_at=now();
  for m in select value from jsonb_array_elements(p_state->'memories') loop
    insert into memory_states(session_id,memory_id,progress,stage,unlocked)
      values(p_id,m->>'id',(m->>'progress')::int,(m->>'stage')::int,(m->>'unlocked')::boolean)
      on conflict(session_id,memory_id) do update set progress=excluded.progress,stage=excluded.stage,unlocked=excluded.unlocked,updated_at=now();
  end loop;
  insert into personality_states(session_id,identity,emotion,trust,connection)
    values(p_id,p,emotional,least(100,(p_state->>'turn')::int*3),relationship)
    on conflict(session_id) do update set identity=excluded.identity,emotion=excluded.emotion,trust=excluded.trust,connection=excluded.connection;
end;
$$;
revoke all on function public.save_live_session(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_live_session(uuid,text,jsonb,text) to service_role;
