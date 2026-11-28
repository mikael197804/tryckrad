create table if not exists jobs (
  id text primary key,
  company text not null,
  title text not null,
  segment text not null default 'Övrigt',
  location text not null,
  employment_type text not null default 'Heltid',
  description text not null,
  contact text not null,
  telegram_user text,
  created_at timestamptz not null default now()
);

create index if not exists jobs_created_at_idx on jobs (created_at desc);
create index if not exists jobs_segment_idx on jobs (segment);
create index if not exists jobs_location_idx on jobs (location);
