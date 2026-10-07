-- =====================================================================
-- 請進 快剪 — 線上叫號（簡單版）Supabase 資料庫設定
-- 使用方式：Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 可以重複執行（不會清掉既有資料）。
--
-- 這個版本只存「現在」的狀態：目前叫到幾號、預估等待時間。
-- 每次叫號都是覆蓋，不留任何歷史紀錄、不記錄客人資料。
-- =====================================================================

-- ★★★ 執行前請先修改密碼（至少 6 位數字）★★★
-- 第一次執行之後，密碼請到「叫號頁 → 設定」修改，再次執行本檔不會覆蓋。
create temporary table pg_setup as
select 'qingjin'::text as shop_id,
       '111111'::text  as pin;          -- ★ 叫號密碼

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 資料表：每家店只有一列，每次叫號直接覆蓋
-- ---------------------------------------------------------------------
create table if not exists public.pager (
  shop_id      text primary key,
  day          date not null default (now() at time zone 'Asia/Taipei')::date,
  current      int  not null default 0,     -- 目前叫到幾號
  prev         int,                         -- 上一號（給「退回」用，只留一筆）
  wait_minutes int,                         -- 老闆輸入的預估等待時間
  wait_set_at  timestamptz,
  last_action  text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.pager_secrets (
  shop_id      text primary key references public.pager(shop_id) on delete cascade,
  pin_hash     text not null,
  failed_count int  not null default 0,
  locked_until timestamptz
);

-- 客人只能「看」目前號碼；密碼表外部完全讀不到
alter table public.pager         enable row level security;
alter table public.pager_secrets enable row level security;
drop policy if exists "public read" on public.pager;
create policy "public read" on public.pager for select using (true);

-- ---------------------------------------------------------------------
-- 叫號（叫號頁、Apple Watch 捷徑都呼叫這個）
--   p_action: ping / next / call（p_number）/ undo / set_wait（p_number = 分鐘）/ set_pin（p_new_pin）
-- ---------------------------------------------------------------------
create or replace function public.pager_action(
  p_shop    text,
  p_pin     text,
  p_action  text,
  p_number  int  default null,
  p_new_pin text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  s     pager;
  k     pager_secrets;
  today date := (now() at time zone 'Asia/Taipei')::date;
  fmt   text;
begin
  -- 密碼檢查：錯 10 次鎖 10 分鐘
  select * into k from pager_secrets where shop_id = p_shop for update;
  if not found then return json_build_object('ok', false, 'message', '找不到店家'); end if;
  if k.locked_until is not null and k.locked_until > now() then
    return json_build_object('ok', false, 'message', '密碼錯誤太多次，請 10 分鐘後再試');
  end if;
  if k.pin_hash <> crypt(coalesce(p_pin, ''), k.pin_hash) then
    update pager_secrets
       set failed_count = case when failed_count + 1 >= 10 then 0 else failed_count + 1 end,
           locked_until = case when failed_count + 1 >= 10 then now() + interval '10 minutes' else null end
     where shop_id = p_shop;
    return json_build_object('ok', false, 'message', '密碼錯誤');
  end if;
  if k.failed_count > 0 then update pager_secrets set failed_count = 0 where shop_id = p_shop; end if;

  -- 換日自動歸零
  update pager set day = today, current = 0, prev = null, wait_minutes = null, wait_set_at = null,
                   last_action = null, updated_at = now()
   where shop_id = p_shop and day <> today;
  select * into s from pager where shop_id = p_shop for update;

  if p_action = 'ping' then
    return json_build_object('ok', true, 'message', '登入成功');

  elsif p_action = 'next' then
    -- 防止手錶連點：3 秒內重複按只算一次
    if s.last_action = 'next' and s.updated_at > now() - interval '3 seconds' then
      return json_build_object('ok', true, 'number', s.current, 'message', '剛剛已叫 ' || lpad(s.current::text, 3, '0') || ' 號');
    end if;
    if s.current >= 999 then return json_build_object('ok', false, 'message', '號碼已到 999'); end if;
    update pager set prev = current, current = current + 1, last_action = 'next', updated_at = now()
     where shop_id = p_shop;
    fmt := lpad((s.current + 1)::text, 3, '0');
    return json_build_object('ok', true, 'number', s.current + 1, 'message', '叫號 ' || fmt);

  elsif p_action = 'call' then
    if p_number is null or p_number < 1 or p_number > 999 then
      return json_build_object('ok', false, 'message', '請輸入 1～999 的號碼');
    end if;
    update pager set prev = current, current = p_number, last_action = 'call', updated_at = now()
     where shop_id = p_shop;
    return json_build_object('ok', true, 'number', p_number, 'message', '叫號 ' || lpad(p_number::text, 3, '0'));

  elsif p_action = 'undo' then
    if s.prev is null then return json_build_object('ok', false, 'message', '沒有可以退回的號碼'); end if;
    update pager set current = prev, prev = null, last_action = 'undo', updated_at = now()
     where shop_id = p_shop;
    return json_build_object('ok', true, 'number', s.prev,
                             'message', '已退回 ' || case when s.prev = 0 then '---' else lpad(s.prev::text, 3, '0') end);

  elsif p_action = 'set_wait' then
    if p_number is null or p_number < 0 or p_number > 180 then
      return json_build_object('ok', false, 'message', '請輸入 0～180 分鐘');
    end if;
    update pager set wait_minutes = p_number, wait_set_at = now(), last_action = 'set_wait', updated_at = now()
     where shop_id = p_shop;
    return json_build_object('ok', true, 'message', '等待時間：' ||
      case when p_number = 0 then '免等' when p_number >= 60 then '60 分鐘以上' else '約 ' || p_number || ' 分鐘' end);

  elsif p_action = 'set_pin' then
    if p_new_pin is null or p_new_pin !~ '^[0-9]{6,12}$' then
      return json_build_object('ok', false, 'message', '新密碼請用 6～12 位數字');
    end if;
    update pager_secrets set pin_hash = crypt(p_new_pin, gen_salt('bf')) where shop_id = p_shop;
    return json_build_object('ok', true, 'message', '密碼已更新');
  end if;

  return json_build_object('ok', false, 'message', '不認識的操作：' || p_action);
end $$;

grant execute on function public.pager_action(text, text, text, int, text) to anon, authenticated;

-- 即時同步：號碼一變，客人頁立刻更新
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pager') then
    alter publication supabase_realtime add table public.pager;
  end if;
end $$;

-- 初始資料
insert into public.pager (shop_id) select shop_id from pg_setup on conflict do nothing;
insert into public.pager_secrets (shop_id, pin_hash)
select shop_id, extensions.crypt(pin, extensions.gen_salt('bf')) from pg_setup
on conflict do nothing;

drop table pg_setup;
