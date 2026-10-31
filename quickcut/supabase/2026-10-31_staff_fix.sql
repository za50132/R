-- 2026-10-31：網頁部署前要先套用這段。只新增欄位和函式，不改、不刪任何資料；可以重複執行。
--   1. 叫號頁的「號碼調整」（目前叫到、抽號機發到、叫回）用店內密碼就能做
--   2. 店長設定可以改設計師每天的上下班時間
-- （setup.sql 裡的 owner_action 也改成呼叫 qc_fix_number，但結果相同，正式資料庫不用重套）

-- ---------------------------------------------------------------------
-- 號碼修正：叫號頁的「號碼調整」用店內密碼就能做（staff_fix），店長頁也走這裡
--   set_number     目前叫到幾號
--   set_issued     已經發到幾號：改大 = 中間補成不指定；改小 = 多發的號碼之後發到時自動蓋掉
--   recall_ticket  把取消或剪完的 p_number 叫回等候名單
-- 歸零不在這裡，仍然要店長密碼（owner_action 的 reset_today）
-- ---------------------------------------------------------------------
create or replace function public.qc_fix_number(p_shop text, p_action text, p_number int) returns json
language plpgsql set search_path = public as $$
declare
  s     shops;
  added int;
begin
  select * into s from shops where id = p_shop for update;

  if p_action = 'set_number' then
    if p_number is null or p_number < 0 or p_number > s.max_number then
      return json_build_object('ok', false, 'message', '請輸入 0～' || s.max_number || ' 的號碼');
    end if;
    insert into call_log (shop_id, action, number, prev_last_called)
    select p_shop, 'set_number', p_number, last_called from shops where id = p_shop;
    update shops set last_called = p_number, updated_at = now() where id = p_shop;
    return json_build_object('ok', true, 'message', '目前叫號改為 ' || qc_fmt(p_number));

  elsif p_action = 'set_issued' then
    if p_number is null or p_number < 0 or p_number > s.max_number then
      return json_build_object('ok', false, 'message', '請輸入 0～' || s.max_number || ' 的號碼');
    end if;
    if p_number > s.last_issued then
      -- 改大：跟補號一樣，中間缺的號碼補成不指定
      added := qc_fill_to(p_shop, p_number);
      return json_build_object('ok', true, 'message', '已補到 ' || qc_fmt(p_number) || ' 號（新增 ' || added || ' 號）');
    elsif p_number = s.last_issued then
      return json_build_object('ok', true, 'message', '已經是 ' || qc_fmt(p_number) || ' 號，不用改');
    else
      -- 改小：只改「已發」這個數字，不動 tickets 表。多發的號碼牌還是會留在等候
      -- 名單上；之後真的發號發到那個號碼時，staff_action 的 issue 會自動蓋掉重發
      -- （見上面 issue 的註解），不用擔心撞號，也不用先手動清掉。
      insert into call_log (shop_id, action, number, prev_last_called)
      select p_shop, 'set_issued', p_number, last_issued from shops where id = p_shop;
      update shops set last_issued = p_number, updated_at = now() where id = p_shop;
    end if;
    return json_build_object('ok', true, 'message', '已發號碼改為 ' || qc_fmt(p_number));

  elsif p_action = 'recall_ticket' then
    if p_number is null or p_number < 1 or p_number > s.max_number then
      return json_build_object('ok', false, 'message', '請輸入 1～' || s.max_number || ' 的號碼');
    end if;
    if not exists (select 1 from tickets where shop_id = p_shop and day = qc_today() and number = p_number) then
      return json_build_object('ok', false, 'message', qc_fmt(p_number) || ' 號今天不存在');
    end if;
    if exists (select 1 from tickets where shop_id = p_shop and day = qc_today() and number = p_number
                 and status in ('waiting', 'serving')) then
      return json_build_object('ok', false, 'message', qc_fmt(p_number) || ' 號目前就在等候或服務中，不用叫回');
    end if;
    update tickets set status = 'waiting', served_by = null, called_at = null, finished_at = null, sort_key = null
     where shop_id = p_shop and day = qc_today() and number = p_number;
    update shops set updated_at = now() where id = p_shop;
    insert into call_log (shop_id, action, number) values (p_shop, 'recall_ticket', p_number);
    return json_build_object('ok', true, 'message', qc_fmt(p_number) || ' 號已叫回，重新排進等候名單');

  end if;

  return json_build_object('ok', false, 'message', '不認識的操作：' || p_action);
end $$;

create or replace function public.staff_fix(p_shop text, p_pin text, p_action text, p_number int) returns json
language plpgsql security definer set search_path = public as $$
declare
  err text;
begin
  err := qc_check_pin(p_shop, p_pin, false);
  if err is not null then return json_build_object('ok', false, 'message', err); end if;
  if p_action not in ('set_number', 'set_issued', 'recall_ticket') then
    return json_build_object('ok', false, 'message', '不認識的操作：' || p_action);
  end if;
  perform qc_roll_day(p_shop);
  return qc_fix_number(p_shop, p_action, p_number);
end $$;

revoke execute on function public.qc_fix_number(text, text, int) from public, anon, authenticated;
grant  execute on function public.staff_fix(text, text, text, int) to anon, authenticated;

-- ===== 2. 上下班時間 =====
alter table public.designers add column if not exists shift_start text
  check (shift_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.designers add column if not exists shift_end text
  check (shift_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ---------------------------------------------------------------------
-- 店長設定設計師每天的上下班時間（'HH:MM'）
-- ---------------------------------------------------------------------
create or replace function public.owner_shift(p_shop text, p_pin text, p_designer text, p_start text, p_end text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  err  text;
  name text;
begin
  err := qc_check_pin(p_shop, p_pin, true);
  if err is not null then return json_build_object('ok', false, 'message', err); end if;
  if coalesce(p_start, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_end, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return json_build_object('ok', false, 'message', '請輸入正確的時間');
  end if;
  if p_start >= p_end then
    return json_build_object('ok', false, 'message', '下班時間要比上班時間晚');
  end if;
  update designers set shift_start = p_start, shift_end = p_end, updated_at = now()
   where shop_id = p_shop and id = p_designer
  returning designers.name into name;
  if name is null then return json_build_object('ok', false, 'message', '找不到這位設計師'); end if;
  return json_build_object('ok', true, 'message', name || ' 上班時間改為 ' || p_start || '–' || p_end);
end $$;

grant  execute on function public.owner_shift(text, text, text, text, text) to anon, authenticated;
