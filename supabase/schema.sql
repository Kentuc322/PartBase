-- Run once in the Supabase SQL Editor for a new project.
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  model text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  quantity integer not null default 0 check (quantity between 0 and 1000000000),
  location text not null default '',
  specifications text not null default '',
  supplier text not null default '',
  datasheet_url text not null default '',
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_parts_user_name on public.parts (user_id, name);
create index if not exists idx_parts_user_model on public.parts (user_id, model);
create index if not exists idx_parts_user_category on public.parts (user_id, category);

alter table public.parts enable row level security;
revoke all on public.parts from anon;
grant select, insert, update, delete on public.parts to authenticated;

create policy "owners can read parts" on public.parts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owners can add parts" on public.parts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owners can edit parts" on public.parts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "owners can delete parts" on public.parts
  for delete to authenticated using (user_id = (select auth.uid()));

-- A single UPDATE prevents simultaneous +/- clicks from overwriting each other.
create or replace function public.adjust_part_quantity(p_id uuid, p_delta integer)
returns setof public.parts
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_delta not in (-1, 1) then
    raise exception 'delta must be -1 or 1';
  end if;
  return query
    update public.parts
    set quantity = quantity + p_delta, updated_at = now()
    where id = p_id
      and user_id = (select auth.uid())
      and quantity + p_delta between 0 and 1000000000
    returning *;
end;
$$;
revoke all on function public.adjust_part_quantity(uuid, integer) from public, anon;
grant execute on function public.adjust_part_quantity(uuid, integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'part-images', 'part-images', false, 5000000,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "owners can view part images" on storage.objects
  for select to authenticated
  using (bucket_id = 'part-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owners can upload part images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'part-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owners can delete part images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'part-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
