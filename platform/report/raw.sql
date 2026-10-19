-- 期間內的原始資料（給 CSV 用），所有客戶一次取回。{{FROM}}、{{TO}}、{{START}} 同 query.sql。
-- 不含任何密碼雜湊值。資料量很大時（例如一整年），改用 client-backups 的每日備份。
select json_build_object(
  'tickets',    (select coalesce(json_agg(t order by t.shop_id, t.day, t.number), '[]'::json) from tickets t
                  where t.day between date {{FROM}} and date {{TO}} and t.issued_at >= timestamptz {{START}}),
  'call_log',   (select coalesce(json_agg(c order by c.shop_id, c.created_at), '[]'::json) from call_log c
                  where (c.created_at at time zone 'Asia/Taipei')::date between date {{FROM}} and date {{TO}} and c.created_at >= timestamptz {{START}}),
  'page_views', (select coalesce(json_agg(p order by p.shop_id, p.created_at), '[]'::json) from page_views p
                  where p.day between date {{FROM}} and date {{TO}} and p.created_at >= timestamptz {{START}}),
  'days_off',   (select coalesce(json_agg(o order by o.shop_id, o.day), '[]'::json) from days_off o
                  where o.day between date {{FROM}} and date {{TO}})
) as raw;
