-- =====================================================================
-- 請進 快剪 — 數據報表
-- 使用方式：Supabase 後台 → SQL Editor → 貼上「其中一段」→ Run
--          結果表格右上角可以下載 CSV；常用的可以按 Save 存起來，下次直接點
-- 每一段都可以單獨執行。時間一律是台北時間。
-- =====================================================================


-- ① 每日總覽（最近 30 天）
--    發號、平均等候、過號率、客人頁使用量，一天一列
with d as (
  select generate_series(current_date - 29, current_date, interval '1 day')::date as day
),
t as (
  select day,
         count(*) filter (where status <> 'cancelled')                                         as tickets,
         round(avg(extract(epoch from called_at - issued_at) / 60)
               filter (where called_at is not null))::int                                     as avg_wait,
         round(max(extract(epoch from called_at - issued_at) / 60))::int                       as max_wait
    from tickets where shop_id = 'qingjin' group by day
),
s as (
  select (created_at at time zone 'Asia/Taipei')::date as day, count(*) as skips
    from call_log where shop_id = 'qingjin' and action = 'skip' and not undone group by 1
),
v as (
  select day,
         count(distinct visitor) filter (where kind = 'open')                 as opens,
         count(distinct visitor) filter (where kind = 'open' and src = 'qr')  as qr_opens,
         count(distinct visitor) filter (where kind = 'lookup')               as lookups
    from page_views where shop_id = 'qingjin' group by day
)
select d.day                                                  as "日期",
       to_char(d.day, 'Dy')                                   as "星期",
       coalesce(t.tickets, 0)                                 as "發號",
       t.avg_wait                                             as "平均等候(分)",
       t.max_wait                                             as "最長等候(分)",
       coalesce(s.skips, 0)                                   as "過號",
       round(100.0 * coalesce(s.skips, 0) / nullif(t.tickets, 0), 1)  as "過號率%",
       coalesce(v.opens, 0)                                   as "開客人頁(人)",
       coalesce(v.qr_opens, 0)                                as "掃QR(人)",
       coalesce(v.lookups, 0)                                 as "查號(人)",
       round(100.0 * coalesce(v.lookups, 0) / nullif(t.tickets, 0), 1) as "查號比例%"
  from d left join t using (day) left join s using (day) left join v using (day)
 order by d.day desc;


-- ② 每週趨勢（最近 12 週）：看「改善」最清楚的一張表
--    基準期、上線期、活動期各週並排比較
with t as (
  select date_trunc('week', day)::date as week,
         count(*) filter (where status <> 'cancelled') as tickets,
         avg(extract(epoch from called_at - issued_at) / 60) filter (where called_at is not null) as avg_wait,
         -- 離峰定義：平日 09–11 點、14–17 點（可以自己改）
         count(*) filter (where status <> 'cancelled'
                            and extract(isodow from day) between 1 and 5
                            and extract(hour from issued_at at time zone 'Asia/Taipei') in (9, 10, 14, 15, 16)) as offpeak
    from tickets where shop_id = 'qingjin' and day >= current_date - 84 group by 1
),
s as (
  select date_trunc('week', (created_at at time zone 'Asia/Taipei')::date)::date as week, count(*) as skips
    from call_log where shop_id = 'qingjin' and action = 'skip' and not undone group by 1
),
v as (
  select date_trunc('week', day)::date as week,
         count(distinct (day, visitor)) filter (where kind = 'lookup') as lookups
    from page_views where shop_id = 'qingjin' group by 1
)
select t.week                                                      as "週一日期",
       t.tickets                                                   as "發號",
       round(t.avg_wait)::int                                      as "平均等候(分)",
       round(100.0 * coalesce(s.skips, 0) / nullif(t.tickets, 0), 1) as "過號率%",
       round(100.0 * t.offpeak / nullif(t.tickets, 0), 1)          as "離峰占比%",
       round(100.0 * coalesce(v.lookups, 0) / nullif(t.tickets, 0), 1) as "查號比例%"
  from t left join s using (week) left join v using (week)
 order by t.week desc;


-- ③ 冷熱時段（最近 8 週）：每個星期幾 × 每小時，平均到店人數和等候
with x as (
  select day, issued_at at time zone 'Asia/Taipei' as at, called_at, issued_at
    from tickets
   where shop_id = 'qingjin' and status <> 'cancelled' and day >= current_date - 56 and day < current_date
),
days as (select extract(isodow from day)::int as dow, count(distinct day) as n from x group by 1)
select x_dow                                                as "星期(1=一)",
       x_hour || ':00'                                      as "時段",
       round(cnt::numeric / days.n, 1)                      as "平均到店(人)",
       round(wait)::int                                     as "平均等候(分)"
  from (
    select extract(isodow from day)::int as x_dow, extract(hour from at)::int as x_hour, count(*) as cnt,
           avg(extract(epoch from called_at - issued_at) / 60) filter (where called_at is not null) as wait
      from x group by 1, 2
  ) h join days on days.dow = h.x_dow
 order by 1, x_hour;


-- ④ 設計師（最近 4 週）：服務人數、被指定人數、指定率（店內指派的不算指定）
select coalesce(d.name, t.served_by)                                 as "設計師",
       count(*)                                                     as "服務人數",
       count(*) filter (where t.designer_id = t.served_by and not t.assigned) as "被指定",
       count(*) filter (where t.designer_id = t.served_by and t.assigned)     as "被指派",
       round(100.0 * count(*) filter (where t.designer_id = t.served_by and not t.assigned) / count(*), 1) as "指定率%"
  from tickets t left join designers d on d.shop_id = t.shop_id and d.id = t.served_by
 where t.shop_id = 'qingjin' and t.served_by is not null and t.day >= current_date - 28
 group by 1 order by 2 desc;


-- ⑤ 客人頁每小時使用量（最近 4 週）：大家都在什麼時候查
select extract(hour from created_at at time zone 'Asia/Taipei')::int || ':00' as "時段",
       count(distinct (day, visitor)) filter (where kind = 'open')                as "開客人頁(人次)",
       count(distinct (day, visitor)) filter (where kind = 'lookup')              as "查號(人次)",
       count(distinct (day, visitor)) filter (where kind = 'open' and src = 'qr') as "掃QR(人次)"
  from page_views
 where shop_id = 'qingjin' and day >= current_date - 28
 group by 1 order by min(extract(hour from created_at at time zone 'Asia/Taipei'));
