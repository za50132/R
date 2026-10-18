-- =====================================================================
-- 平台共用：客戶名冊（clients）＋ 共用使用紀錄（events）
-- 所有客戶、所有系統共用。可以重複執行。只新增，不刪改既有資料。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 客戶名冊：每一家客戶一列。代號規則：小寫英文開頭，小寫英文/數字，用 - 連接，最長 40 字
--   例：cut-qingjin、food-xxx、clinic-xxx（請進沿用舊代號 qingjin）
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id          text primary key
              check (id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(id) <= 40),
  name        text not null,                         -- 顯示用店名，可以改
  industry    text,                                  -- 行業，例：快剪、餐飲、診所
  systems     text[] not null default '{}',          -- 用了哪些系統，例：{queue}、{booking,member}
  status      text not null default 'active' check (status in ('active', 'paused', 'ended')),
  started_on  date,                                  -- 正式開始使用（報表從這天算，之前算測試期）
  ended_on    date,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.clients enable row level security;   -- 沒有 policy = 外部完全讀不到

insert into public.clients (id, name, industry, systems, started_on, note)
values ('qingjin', '請進', '快剪', '{queue}', null, '正式啟用日期待定')
on conflict (id) do nothing;

-- 叫號系統的店家一定要先在名冊裡（打錯代號會被資料庫拒絕）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shops_client_fk') then
    alter table public.shops add constraint shops_client_fk
      foreign key (id) references public.clients(id) on update restrict on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 共用使用紀錄：不管哪個系統，「誰在什麼時候做了什麼」都記在這裡，報表可以跨客戶比較
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          bigserial primary key,
  client_id   text not null references public.clients(id) on update restrict on delete restrict,
  system      text not null check (system ~ '^[a-z][a-z0-9_]{0,29}$'),   -- 例：queue、booking
  event       text not null check (event ~ '^[a-z][a-z0-9_]{0,39}$'),    -- 例：page_open、next
  actor       text not null default 'customer' check (actor in ('customer', 'staff', 'owner', 'system')),
  visitor     text check (length(visitor) <= 40),    -- 瀏覽器每天重新產生的隨機代號，不是身分
  source      text check (length(source) <= 20),     -- 例：qr
  props       jsonb not null default '{}'::jsonb,    -- 各系統自己的補充資料（號碼、設計師…）
  occurred_at timestamptz not null default now(),
  day         date not null default (now() at time zone 'Asia/Taipei')::date
);
create index if not exists events_client_time on public.events (client_id, occurred_at);
create index if not exists events_client_event_day on public.events (client_id, system, event, day);
alter table public.events enable row level security;    -- 外部完全讀不到

-- ---------------------------------------------------------------------
-- 給以後的新系統用：網頁直接記一筆「客人」的使用紀錄（只能記 actor = customer）
-- 同一個人 10 分鐘內同一件事只算一次；每家客戶每天最多 2 萬筆，避免被灌資料
-- ---------------------------------------------------------------------
create or replace function public.track_event(
  p_client  text,
  p_system  text,
  p_event   text,
  p_visitor text default null,
  p_source  text default null,
  p_props   jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_client is null or p_system !~ '^[a-z][a-z0-9_]{0,29}$' or p_event !~ '^[a-z][a-z0-9_]{0,39}$' then return; end if;
  if length(coalesce(p_visitor, '')) > 40 or pg_column_size(coalesce(p_props, '{}'::jsonb)) > 2000 then return; end if;
  if not exists (select 1 from clients where id = p_client and status = 'active') then return; end if;
  if p_visitor is not null and exists (
       select 1 from events
        where client_id = p_client and system = p_system and event = p_event and visitor = p_visitor
          and occurred_at > now() - interval '10 minutes') then return; end if;
  if (select count(*) from events where client_id = p_client
        and day = (now() at time zone 'Asia/Taipei')::date) >= 20000 then return; end if;
  insert into events (client_id, system, event, actor, visitor, source, props)
  values (p_client, p_system, p_event, 'customer', p_visitor, left(nullif(p_source, ''), 20), coalesce(p_props, '{}'::jsonb));
end $$;
revoke execute on function public.track_event(text, text, text, text, text, jsonb) from public;
grant  execute on function public.track_event(text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 叫號系統（queue）自動同步到共用紀錄：網頁不用改
--   客人頁 page_views → page_open / number_lookup
--   店內操作 call_log → issue、next、skip、dispatch…（actor = staff；店長操作 = owner）
-- ---------------------------------------------------------------------
create or replace function public.qc_mirror_page_view() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from clients where id = new.shop_id) then
    insert into events (client_id, system, event, actor, visitor, source, occurred_at, day)
    values (new.shop_id, 'queue', case new.kind when 'open' then 'page_open' else 'number_lookup' end,
            'customer', new.visitor, new.src, new.created_at, new.day);
  end if;
  return new;
end $$;

create or replace function public.qc_mirror_call_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from clients where id = new.shop_id) and new.action ~ '^[a-z][a-z0-9_]{0,39}$' then
    insert into events (client_id, system, event, actor, props, occurred_at, day)
    values (new.shop_id, 'queue', new.action,
            case when new.action in ('set_number', 'reset') then 'owner' else 'staff' end,
            jsonb_strip_nulls(jsonb_build_object('number', new.number, 'designer', new.designer_id)),
            new.created_at, (new.created_at at time zone 'Asia/Taipei')::date);
  end if;
  return new;
end $$;

revoke execute on function public.qc_mirror_page_view() from public, anon, authenticated;
revoke execute on function public.qc_mirror_call_log()  from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'page_views_to_events') then
    create trigger page_views_to_events after insert on public.page_views
      for each row execute function public.qc_mirror_page_view();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'call_log_to_events') then
    create trigger call_log_to_events after insert on public.call_log
      for each row execute function public.qc_mirror_call_log();
  end if;
end $$;

-- 把既有紀錄補進共用紀錄（只在 events 還沒有 queue 資料時做一次）
insert into public.events (client_id, system, event, actor, visitor, source, occurred_at, day)
select p.shop_id, 'queue', case p.kind when 'open' then 'page_open' else 'number_lookup' end,
       'customer', p.visitor, p.src, p.created_at, p.day
  from public.page_views p join public.clients c on c.id = p.shop_id
 where not exists (select 1 from public.events where system = 'queue');

insert into public.events (client_id, system, event, actor, props, occurred_at, day)
select l.shop_id, 'queue', l.action,
       case when l.action in ('set_number', 'reset') then 'owner' else 'staff' end,
       jsonb_strip_nulls(jsonb_build_object('number', l.number, 'designer', l.designer_id)),
       l.created_at, (l.created_at at time zone 'Asia/Taipei')::date
  from public.call_log l join public.clients c on c.id = l.shop_id
 where l.action ~ '^[a-z][a-z0-9_]{0,39}$'
   and not exists (select 1 from public.events where system = 'queue' and actor <> 'customer');
