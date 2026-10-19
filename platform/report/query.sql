-- 所有客戶的統計數據，一次取回成一個 JSON。
-- 使用前把 {{FROM}}、{{TO}} 換成台北日期，例如 '2026-10-01'、'2026-10-31'（含頭尾）。
-- {{START}} 是正式啟用的時間點，之前的資料不算（例 '2026-10-19 13:00+08'）；沒有就填 {{FROM}} 那天的 '00:00+08'。
-- 只讀取，不會改任何資料。
with params as (select date {{FROM}} as d_from, date {{TO}} as d_to, timestamptz {{START}} as ts_from),
days as (select g::date as day, ts_from from params, generate_series(d_from, d_to, interval '1 day') g),
shop_list as (select id from shops order by id)
select json_build_object(
  'from', (select d_from from params),
  'to',   (select d_to from params),
  'generated_at', now(),
  'shops', (select json_agg(json_build_object(
    'id', s.id,
    'daily', (select json_agg(json_build_object(
        'day', d.day,
        'tickets', (select count(*) from tickets t where t.shop_id = s.id and t.day = d.day and t.issued_at >= d.ts_from and t.status <> 'cancelled'),
        'called',  (select count(*) from tickets t where t.shop_id = s.id and t.day = d.day and t.issued_at >= d.ts_from and t.called_at is not null),
        'avg_wait', (select round(avg(extract(epoch from t.called_at - t.issued_at) / 60))::int
                       from tickets t where t.shop_id = s.id and t.day = d.day and t.issued_at >= d.ts_from and t.called_at is not null),
        'skips', (select count(*) from call_log c where c.shop_id = s.id and c.action = 'skip' and not c.undone and c.created_at >= d.ts_from
                    and (c.created_at at time zone 'Asia/Taipei')::date = d.day),
        'opens',   (select count(distinct visitor) from page_views p where p.shop_id = s.id and p.day = d.day and p.created_at >= d.ts_from and p.kind = 'open'),
        'qr',      (select count(distinct visitor) from page_views p where p.shop_id = s.id and p.day = d.day and p.created_at >= d.ts_from and p.kind = 'open' and p.src = 'qr'),
        'lookups', (select count(distinct visitor) from page_views p where p.shop_id = s.id and p.day = d.day and p.created_at >= d.ts_from and p.kind = 'lookup')
      ) order by d.day) from days d),
    'open_hours', (select coalesce(json_agg(json_build_object('hour', h, 'n', n) order by h), '[]'::json) from (
        select extract(hour from created_at at time zone 'Asia/Taipei')::int h, count(distinct (day, visitor)) n
          from page_views p, params where p.shop_id = s.id and p.kind = 'open' and p.day between d_from and d_to and p.created_at >= ts_from group by 1) x),
    'ticket_hours', (select coalesce(json_agg(json_build_object('hour', h, 'n', n) order by h), '[]'::json) from (
        select extract(hour from issued_at at time zone 'Asia/Taipei')::int h, count(*) n
          from tickets t, params where t.shop_id = s.id and t.status <> 'cancelled' and t.day between d_from and d_to and t.issued_at >= ts_from group by 1) x),
    'designers', (select coalesce(json_agg(json_build_object('id', dz.id, 'name', dz.name, 'served', coalesce(x.served, 0),
                    'chosen', coalesce(x.chosen, 0), 'dispatched', coalesce(x.dispatched, 0)) order by dz.sort), '[]'::json)
        from designers dz left join (
          select served_by, count(*) served,
                 count(*) filter (where designer_id = served_by and not assigned) chosen,
                 count(*) filter (where designer_id = served_by and assigned) dispatched
            from tickets t, params where t.shop_id = s.id and t.day between d_from and d_to and t.issued_at >= ts_from and t.served_by is not null group by 1
        ) x on x.served_by = dz.id where dz.shop_id = s.id)
  ) order by s.id) from shop_list s)
) as report;
