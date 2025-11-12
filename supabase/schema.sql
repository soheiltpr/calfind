create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  start_date date,
  end_date date,
  start_time text,
  end_time text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_invitees (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  password text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_path text not null,
  file_type text not null,
  total_pages integer,
  current_version integer not null default 1,
  uploaded_by uuid references public.project_invitees(id) on delete set null,
  shared_with_all boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_permissions (
  document_id uuid not null references public.project_documents(id) on delete cascade,
  invitee_id uuid not null references public.project_invitees(id) on delete cascade,
  can_view boolean not null default true,
  can_edit boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (document_id, invitee_id)
);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents(id) on delete cascade,
  version integer not null,
  merged_file_path text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, version)
);

create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents(id) on delete cascade,
  invitee_id uuid not null references public.project_invitees(id) on delete cascade,
  version integer not null,
  strokes_json jsonb,
  typed_text text,
  typed_font text,
  typed_color text,
  uploaded_signature_path text,
  overlay_image_path text,
  signed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_id, invitee_id)
);

create table if not exists public.availability_responses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invitee_id uuid references public.project_invitees(id) on delete cascade,
  name text not null,
  slots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists availability_unique_participant
  on public.availability_responses (project_id, name);

create unique index if not exists availability_unique_invitee
  on public.availability_responses (invitee_id);

alter table public.projects
  enable row level security;

alter table public.availability_responses
  enable row level security;

alter table public.project_invitees
  enable row level security;

alter table public.project_documents
  enable row level security;

alter table public.document_permissions
  enable row level security;

alter table public.document_versions
  enable row level security;

alter table public.document_signatures
  enable row level security;

create policy if not exists "anon can read projects"
  on public.projects
  for select
  using (true);

create policy if not exists "anon can insert projects"
  on public.projects
  for insert
  with check (true);

create policy if not exists "anon can read invitees"
  on public.project_invitees
  for select
  using (true);

create policy if not exists "anon can insert invitees"
  on public.project_invitees
  for insert
  with check (true);

create policy if not exists "anon can read availabilities"
  on public.availability_responses
  for select
  using (true);

create policy if not exists "anon can upsert availabilities"
  on public.availability_responses
  for insert
  with check (true);

create policy if not exists "anon can update own availability"
  on public.availability_responses
  for update
  using (true)
  with check (true);

create policy if not exists "anon can read documents"
  on public.project_documents
  for select
  using (
    exists (
      select 1
      from public.project_invitees pi
      where pi.project_id = project_id
        and pi.id = coalesce(current_setting('request.jwt.claims', true)::json->>'invitee_id', '00000000-0000-0000-0000-000000000000')::uuid
    )
  );

create policy if not exists "anon can insert documents"
  on public.project_documents
  for insert
  with check (true);

create policy if not exists "anon can read doc permissions"
  on public.document_permissions
  for select
  using (true);

create policy if not exists "anon can upsert doc permissions"
  on public.document_permissions
  for insert
  with check (true);

create policy if not exists "anon can read doc versions"
  on public.document_versions
  for select
  using (true);

create policy if not exists "anon can insert doc versions"
  on public.document_versions
  for insert
  with check (true);

create policy if not exists "anon can read signatures"
  on public.document_signatures
  for select
  using (true);

create policy if not exists "anon can upsert signatures"
  on public.document_signatures
  for insert
  with check (true);

create policy if not exists "anon can update signatures"
  on public.document_signatures
  for update
  using (true)
  with check (true);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

-- activity logs capture project events
create table if not exists public.project_activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invitee_id uuid references public.project_invitees(id) on delete set null,
  actor_name text,
  action text not null,
  details jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.project_activity_logs enable row level security;

drop policy if exists "anon can read project activity logs" on public.project_activity_logs;
drop policy if exists "anon can insert project activity logs" on public.project_activity_logs;
create policy "anon can read project activity logs"
  on public.project_activity_logs
  for select
  using (true);
create policy "anon can insert project activity logs"
  on public.project_activity_logs
  for insert
  with check (true);

-- notes that accompany signed documents
create table if not exists public.document_notes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents(id) on delete cascade,
  invitee_id uuid references public.project_invitees(id) on delete set null,
  content text not null,
  visible_to uuid[],
  allow_replies boolean default false,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.document_notes enable row level security;

drop policy if exists "anon can read document notes" on public.document_notes;
drop policy if exists "anon can insert document notes" on public.document_notes;
create policy "anon can read document notes"
  on public.document_notes
  for select
  using (true);
create policy "anon can insert document notes"
  on public.document_notes
  for insert
  with check (true);

create table if not exists public.document_note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.document_notes(id) on delete cascade,
  invitee_id uuid references public.project_invitees(id) on delete set null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.document_note_replies enable row level security;

drop policy if exists "anon can read document note replies" on public.document_note_replies;
drop policy if exists "anon can insert document note replies" on public.document_note_replies;
create policy "anon can read document note replies"
  on public.document_note_replies
  for select
  using (true);
create policy "anon can insert document note replies"
  on public.document_note_replies
  for insert
  with check (true);


drop trigger if exists set_updated_at on public.availability_responses;
create trigger set_updated_at
before update on public.availability_responses
for each row
execute function public.handle_updated_at();


