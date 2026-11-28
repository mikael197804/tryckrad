create table if not exists jobs (
  id text primary key,
  company text not null,
  title text not null,
  location text not null,
  employment_type text not null default 'Heltid',
  description text not null,
  contact text not null,
  telegram_user text,
  created_at timestamptz not null default now()
);

create index if not exists jobs_created_at_idx on jobs (created_at desc);
