-- 桌面端「手机扫码授权登录」链接码（见 packages/bridge-protocol/src/device-link.ts）。
--
-- 生命周期：桌面端 start 建行（pending，短时效）→ 手机 approve 绑定 Worker
-- 并把行改为 approved（时效拉长为设备凭据有效期）→ 桌面端 poll 取回账号身份。
-- secret 只存 sha256（明文只在桌面端本地），泄露数据库也无法冒用设备凭据。
create table if not exists device_links (
  code                  text primary key,
  secret_hash           text not null,
  host_key              text not null,
  name                  text not null default '',
  platform              text not null default '',
  status                text not null default 'pending',
  user_id               text,
  email                 text,
  worker_id             text,
  start_ip              text not null default '',
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  approved_at           timestamptz
);
create index if not exists device_links_expires_idx on device_links (expires_at);
create index if not exists device_links_secret_idx on device_links (secret_hash);