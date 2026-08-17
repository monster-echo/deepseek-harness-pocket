-- gateway 自有库初始化（与 zhongbei_auth 完全隔离）
create table if not exists workers (
  id            text primary key,
  host_key      text not null unique,
  name          text not null default '',
  fingerprint   text not null default '',
  dsh_version   text,
  pairing_code  text not null default '',
  last_seen_at  timestamptz not null default now()
);

create table if not exists pairings (
  user_id    text not null,
  worker_id  text not null references workers(id) on delete cascade,
  name       text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, worker_id)
);
create index if not exists pairings_user_idx on pairings (user_id) where revoked_at is null;

create table if not exists devices (
  user_id         text not null,
  device_key      text not null,
  platform        text not null default 'ios',
  expo_push_token text,
  last_seen_at    timestamptz not null default now(),
  primary key (user_id, device_key)
);

create table if not exists usage_events (
  id        bigserial primary key,
  user_id   text,
  worker_id text,
  kind      text not null,
  meta      jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index if not exists usage_events_user_idx on usage_events (user_id, at);
