-- =====================================================================
-- 系統目錄：你做的每一套系統一列。clients.systems、events.system 都用這裡的代號。
-- 可以重複執行。
-- =====================================================================
create table if not exists public.systems (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{0,29}$'),
  name        text not null,          -- 系統名稱
  for_whom    text,                   -- 適合的行業
  description text,
  created_at  timestamptz not null default now()
);
alter table public.systems enable row level security;   -- 外部讀不到

insert into public.systems (id, name, for_whom, description) values
  ('queue',      '叫號看號'    , '現場排隊的店家（快剪等）', '店內加號、叫號；客人用手機看目前叫號、查自己的號碼'),
  ('cinderella', '仙杜瑞拉',     '美甲、美髮、美容業',       '美業專用系統')
on conflict (id) do update set name = excluded.name, for_whom = excluded.for_whom, description = excluded.description;

-- 店名就叫「請進」
update public.clients set name = '請進' where id = 'qingjin' and name = '請進快剪';
