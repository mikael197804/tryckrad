alter table jobs add column if not exists segment text not null default 'Övrigt';
create index if not exists jobs_segment_idx on jobs (segment);
create index if not exists jobs_location_idx on jobs (location);
