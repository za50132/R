-- =====================================================================
-- 請進 快剪 — 線上看號  Supabase 資料庫設定
-- 使用方式：Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可以重複執行（不會清掉既有資料）。
-- =====================================================================

-- ★★★ 執行前請先修改下面兩組密碼（至少 6 位數字）★★★
--   店內密碼：所有設計師共用，用來叫號
--   店長密碼：排休、歸零、改號碼、改密碼
-- 第一次執行之後，密碼請到「操作頁 → 店長設定」修改，再次執行本檔不會覆蓋。
create temporary table qc_setup_pins as
select 'qingjin'::text as shop_id,
       '111111'::text  as staff_pin,   -- ★ 店內密碼
       '999999'::text  as owner_pin;   -- ★ 店長密碼

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------
create table if not exists public.shops (
  id          text primary key,
  day         date not null default (now() at time zone 'Asia/Taipei')::date,
  last_called int  not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.designers (
  shop_id        text not null references public.shops(id) on delete cascade,
  id             text not null,
  name           text not null,
  sort           int  not null default 0,
  status         text not null default 'working' check (status in ('working', 'break')),
  current_number int,
  updated_at     timestamptz not null default now(),
  primary key (shop_id, id)
);

-- 最後叫號時間：用來判斷設計師是否空檔中（「現在人少」提示）
alter table public.designers add column if not exists called_at timestamptz;

-- 當班人員評估的等候時間（分鐘）與評估時間
alter table public.shops add column if not exists wait_minutes int;
alter table public.shops add column if not exists wait_set_at  timestamptz;

create table if not exists public.days_off (
  shop_id     text not null,
  designer_id text not null,
  day         date not null,
  primary key (shop_id, designer_id, day),
  foreign key (shop_id, designer_id) references public.designers(shop_id, id) on delete cascade
);

-- 每一次叫號都留紀錄：第二階段用來分析冷熱時段
create table if not exists public.call_log (
  id               bigserial primary key,
  shop_id          text not null,
  designer_id      text,
  action           text not null,
  number           int,
  prev_number      int,
  prev_last_called int,
  undone           boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists call_log_shop_time on public.call_log (shop_id, created_at);

create table if not exists public.shop_secrets (
  shop_id        text primary key references public.shops(id) on delete cascade,
  staff_pin_hash text not null,
  owner_pin_hash text not null,
  failed_count   int not null default 0,
  locked_until   timestamptz
);

-- ---------------------------------------------------------------------
-- 權限：客人只能「看」，所有修改都要透過下面有密碼檢查的函式
-- ---------------------------------------------------------------------
alter table public.shops        enable row level security;
alter table public.designers    enable row level security;
alter table public.days_off     enable row level security;
alter table public.call_log     enable row level security;  -- 沒有任何 policy = 外部完全讀不到
alter table public.shop_secrets enable row level security;  -- 同上

drop policy if exists "public read" on public.shops;
drop policy if exists "public read" on public.designers;
drop policy if exists "public read" on public.days_off;
create policy "public read" on public.shops     for select using (true);
create policy "public read" on public.designers for select using (true);
create policy "public read" on public.days_off  for select using (true);

-- ---------------------------------------------------------------------
-- 內部小工具
-- ---------------------------------------------------------------------
create or replace function public.qc_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Taipei')::date $$;

-- 換日自動歸零：每天第一次操作時，號碼從 001 重新開始
create or replace function public.qc_roll_day(p_shop text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update shops set day = qc_today(), last_called = 0, wait_minutes = null, wait_set_at = null, updated_at = now()
   where id = p_shop and day <> qc_today();
  if found then
    update designers set current_number = null, called_at = null, status = 'working', updated_at = now()
     where shop_id = p_shop;
  end if;
end $$;

-- 檢查密碼；錯太多次會鎖 10 分鐘。回傳 null = 通過，否則回傳錯誤訊息。
-- 店長密碼也可以通過店內密碼的檢查。
create or replace function public.qc_check_pin(p_shop text, p_pin text, p_owner boolean) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  s  shop_secrets;
  ok boolean;
begin
  select * into s from shop_secrets where shop_id = p_shop for update;
  if not found then return '找不到店家'; end if;
  if s.locked_until is not null and s.locked_until > now() then
    return '密碼錯誤太多次，請 10 分鐘後再試';
  end if;

  ok := s.owner_pin_hash = crypt(coalesce(p_pin, ''), s.owner_pin_hash)
        or (not p_owner and s.staff_pin_hash = crypt(coalesce(p_pin, ''), s.staff_pin_hash));

  if ok then
    if s.failed_count > 0 then
      update shop_secrets set failed_count = 0, locked_until = null where shop_id = p_shop;
    end if;
    return null;
  end if;

  update shop_secrets
     set failed_count = case when failed_count + 1 >= 10 then 0 else failed_count + 1 end,
         locked_until = case when failed_count + 1 >= 10 then now() + interval '10 minutes' else null end
   where shop_id = p_shop;
  return '密碼錯誤';
end $$;

create or replace function public.qc_fmt(n int) returns text
language sql immutable as $$ select case when n is null then '---' else lpad(n::text, 3, '0') end $$;

create or replace function public.qc_wait_text(n int) returns text
language sql immutable as $$
  select case when n is null then '未評估' when n <= 0 then '免等' when n >= 60 then '60 分鐘以上'
              else '約 ' || n || ' 分鐘' end
$$;

-- ---------------------------------------------------------------------
-- 設計師操作（操作頁、Apple Watch 捷徑都呼叫這個）
--   p_action: ping / status / next / call / undo / break / back / toggle_break / set_wait
-- ---------------------------------------------------------------------
create or replace function public.staff_action(
  p_shop     text,
  p_pin      text,
  p_designer text default null,
  p_action   text default 'status',
  p_number   int  default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  err text;
  s   shops;
  d   designers;
  l   call_log;
  n   int;
  msg text;
begin
  err := qc_check_pin(p_shop, p_pin, false);
  if err is not null then return json_build_object('ok', false, 'message', err); end if;

  perform qc_roll_day(p_shop);
  select * into s from shops where id = p_shop for update;

  if p_action = 'ping' then
    return json_build_object('ok', true, 'message', '登入成功');
  end if;

  if p_action = 'status' then
    select '目前叫號 ' || qc_fmt(s.last_called)
           || case when s.wait_set_at > now() - interval '60 minutes'
                   then E'\n等候 ' || qc_wait_text(s.wait_minutes) else '' end
           || coalesce(E'\n' || string_agg(
             x.name || '：' || case when x.status = 'break' then '休息中' else qc_fmt(x.current_number) end,
             E'\n' order by x.sort), '')
      into msg from designers x where x.shop_id = p_shop;
    return json_build_object('ok', true, 'message', msg, 'last_called', s.last_called);
  end if;

  -- 當班人員評估等候時間（p_number = 分鐘數，0 = 免等）
  if p_action = 'set_wait' then
    if p_number is null or p_number < 0 or p_number > 180 then
      return json_build_object('ok', false, 'message', '請輸入 0～180 分鐘');
    end if;
    update shops set wait_minutes = p_number, wait_set_at = now(), updated_at = now() where id = p_shop;
    insert into call_log (shop_id, designer_id, action, number)
    values (p_shop, (select id from designers where shop_id = p_shop and id = p_designer), 'set_wait', p_number);
    return json_build_object('ok', true, 'wait_minutes', p_number,
                             'message', '等候時間：' || qc_wait_text(p_number));
  end if;

  select * into d from designers where shop_id = p_shop and id = p_designer for update;
  if not found then return json_build_object('ok', false, 'message', '找不到這位設計師'); end if;

  if p_action = 'next' then
    -- 防止手錶連點：4 秒內重複按只算一次
    if exists (select 1 from call_log
                where shop_id = p_shop and designer_id = p_designer and action in ('next', 'call')
                  and not undone and created_at > now() - interval '4 seconds'
                  and created_at >= (qc_today()::timestamp at time zone 'Asia/Taipei')) then
      return json_build_object('ok', true, 'number', d.current_number, 'last_called', s.last_called,
                               'message', '剛剛已叫 ' || qc_fmt(d.current_number) || ' 號');
    end if;
    n := s.last_called + 1;
    if n > 999 then return json_build_object('ok', false, 'message', '號碼已到 999，請店長修改號碼'); end if;
    insert into call_log (shop_id, designer_id, action, number, prev_number, prev_last_called)
    values (p_shop, p_designer, 'next', n, d.current_number, s.last_called);
    update shops set last_called = n, updated_at = now() where id = p_shop;
    update designers set current_number = n, called_at = now(), status = 'working', updated_at = now()
     where shop_id = p_shop and id = p_designer;
    return json_build_object('ok', true, 'number', n, 'last_called', n,
                             'message', d.name || ' 叫號 ' || qc_fmt(n));

  elsif p_action = 'call' then
    if p_number is null or p_number < 1 or p_number > 999 then
      return json_build_object('ok', false, 'message', '請輸入 1～999 的號碼');
    end if;
    insert into call_log (shop_id, designer_id, action, number, prev_number, prev_last_called)
    values (p_shop, p_designer, 'call', p_number, d.current_number, s.last_called);
    update shops set last_called = greatest(last_called, p_number), updated_at = now() where id = p_shop;
    update designers set current_number = p_number, called_at = now(), status = 'working', updated_at = now()
     where shop_id = p_shop and id = p_designer;
    return json_build_object('ok', true, 'number', p_number, 'last_called', greatest(s.last_called, p_number),
                             'message', d.name || ' 叫號 ' || qc_fmt(p_number));

  elsif p_action = 'undo' then
    select * into l from call_log
     where shop_id = p_shop and designer_id = p_designer and action in ('next', 'call')
       and not undone and created_at >= (qc_today()::timestamp at time zone 'Asia/Taipei')
     order by id desc limit 1 for update;
    if not found then return json_build_object('ok', false, 'message', '沒有可以退回的叫號'); end if;
    update call_log set undone = true where id = l.id;
    update designers
       set current_number = l.prev_number,
           called_at = (select max(created_at) from call_log
                         where shop_id = p_shop and designer_id = p_designer and action in ('next', 'call')
                           and not undone and created_at >= (qc_today()::timestamp at time zone 'Asia/Taipei')),
           updated_at = now()
     where shop_id = p_shop and id = p_designer;
    -- 只有在這之後沒人再叫號時，才把全店號碼一起退回
    if s.last_called = l.number then
      update shops set last_called = l.prev_last_called, updated_at = now() where id = p_shop;
    end if;
    return json_build_object('ok', true, 'number', l.prev_number,
                             'message', d.name || ' 已退回，目前 ' || qc_fmt(l.prev_number));

  elsif p_action in ('break', 'back', 'toggle_break') then
    if p_action = 'toggle_break' then
      p_action := case when d.status = 'break' then 'back' else 'break' end;
    end if;
    update designers set status = case when p_action = 'break' then 'break' else 'working' end,
                         updated_at = now()
     where shop_id = p_shop and id = p_designer;
    insert into call_log (shop_id, designer_id, action) values (p_shop, p_designer, p_action);
    return json_build_object('ok', true,
                             'message', d.name || case when p_action = 'break' then ' 休息中' else ' 回來上工' end);
  end if;

  return json_build_object('ok', false, 'message', '不認識的操作：' || p_action);
end $$;

-- ---------------------------------------------------------------------
-- 店長操作
--   p_action: ping / day_off / day_on / set_number / reset_today / set_staff_pin / set_owner_pin
-- ---------------------------------------------------------------------
create or replace function public.owner_action(
  p_shop     text,
  p_pin      text,
  p_action   text,
  p_designer text default null,
  p_day      date default null,
  p_number   int  default null,
  p_new_pin  text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  err text;
begin
  err := qc_check_pin(p_shop, p_pin, true);
  if err is not null then return json_build_object('ok', false, 'message', err); end if;

  perform qc_roll_day(p_shop);

  if p_action = 'ping' then
    return json_build_object('ok', true, 'message', '店長登入成功');

  elsif p_action = 'day_off' then
    insert into days_off (shop_id, designer_id, day) values (p_shop, p_designer, p_day)
    on conflict do nothing;
    update shops set updated_at = now() where id = p_shop;
    return json_build_object('ok', true, 'message', '已設定休假');

  elsif p_action = 'day_on' then
    delete from days_off where shop_id = p_shop and designer_id = p_designer and day = p_day;
    update shops set updated_at = now() where id = p_shop;
    return json_build_object('ok', true, 'message', '已取消休假');

  elsif p_action = 'set_number' then
    if p_number is null or p_number < 0 or p_number > 999 then
      return json_build_object('ok', false, 'message', '請輸入 0～999 的號碼');
    end if;
    insert into call_log (shop_id, action, number, prev_last_called)
    select p_shop, 'set_number', p_number, last_called from shops where id = p_shop;
    update shops set last_called = p_number, updated_at = now() where id = p_shop;
    return json_build_object('ok', true, 'message', '目前叫號改為 ' || qc_fmt(p_number));

  elsif p_action = 'reset_today' then
    insert into call_log (shop_id, action, prev_last_called)
    select p_shop, 'reset', last_called from shops where id = p_shop;
    update shops set last_called = 0, wait_minutes = null, wait_set_at = null, updated_at = now() where id = p_shop;
    update designers set current_number = null, called_at = null, status = 'working', updated_at = now() where shop_id = p_shop;
    return json_build_object('ok', true, 'message', '已歸零，下一位從 001 開始');

  elsif p_action in ('set_staff_pin', 'set_owner_pin') then
    if p_new_pin is null or p_new_pin !~ '^[0-9]{6,12}$' then
      return json_build_object('ok', false, 'message', '新密碼請用 6～12 位數字');
    end if;
    if p_action = 'set_staff_pin' then
      update shop_secrets set staff_pin_hash = crypt(p_new_pin, gen_salt('bf')) where shop_id = p_shop;
    else
      update shop_secrets set owner_pin_hash = crypt(p_new_pin, gen_salt('bf')) where shop_id = p_shop;
    end if;
    return json_build_object('ok', true, 'message', '密碼已更新');
  end if;

  return json_build_object('ok', false, 'message', '不認識的操作：' || p_action);
end $$;

-- ---------------------------------------------------------------------
-- 人潮統計（客人頁「什麼時候來最不用等」）
-- 只回傳過去 8 週「每個星期幾、每個小時」平均叫號人數，不會透露任何單筆紀錄。
-- ---------------------------------------------------------------------
create or replace function public.crowd_stats(p_shop text) returns json
language sql stable security definer set search_path = public as $$
  with calls as (
    select created_at at time zone 'Asia/Taipei' as t
      from call_log
     where shop_id = p_shop and action in ('next', 'call') and not undone
       and created_at >= now() - interval '56 days'
       and created_at < (qc_today()::timestamp at time zone 'Asia/Taipei')   -- 不含今天
  ),
  days as (select t::date as d from calls group by 1),
  per_dow as (select extract(dow from d)::int as dow, count(*) as n from days group by 1),
  per_hour as (
    select extract(dow from t)::int as dow, extract(hour from t)::int as hour, count(*) as c
      from calls group by 1, 2
  )
  select json_build_object(
    'days', (select count(*) from days),
    'hours', coalesce((
      select json_agg(json_build_object('dow', h.dow, 'hour', h.hour, 'avg', round(h.c::numeric / p.n, 1))
                      order by h.dow, h.hour)
        from per_hour h join per_dow p using (dow)), '[]'::json)
  );
$$;

-- 內部工具不對外開放；只開放 staff_action / owner_action
revoke execute on function public.qc_roll_day(text)                from public, anon, authenticated;
revoke execute on function public.qc_check_pin(text, text, boolean) from public, anon, authenticated;
grant  execute on function public.staff_action(text, text, text, text, int) to anon, authenticated;
grant  execute on function public.owner_action(text, text, text, text, date, int, text) to anon, authenticated;
grant  execute on function public.crowd_stats(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 即時同步：這三張表有變動時，客人頁會立刻更新
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['shops', 'designers', 'days_off'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 店家與設計師初始資料（id 要跟 config.js 一樣）
-- ---------------------------------------------------------------------
insert into public.shops (id) select shop_id from qc_setup_pins on conflict do nothing;

insert into public.designers (shop_id, id, name, sort) values
  ('qingjin', 'jiang', '江江', 1),
  ('qingjin', 'chien', '琪恩', 2),
  ('qingjin', 'tim',   'Tim',  3),
  ('qingjin', 'katie', '凱蒂', 4)
on conflict (shop_id, id) do update set name = excluded.name, sort = excluded.sort;

insert into public.shop_secrets (shop_id, staff_pin_hash, owner_pin_hash)
select shop_id, extensions.crypt(staff_pin, extensions.gen_salt('bf')),
                extensions.crypt(owner_pin, extensions.gen_salt('bf'))
  from qc_setup_pins
on conflict do nothing;

drop table qc_setup_pins;
