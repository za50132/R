/*
 * 資料層：有 Supabase 設定就連雲端；沒有就用「示範模式」（存在這台電腦的瀏覽器）。
 * 兩種模式對外的介面相同：
 *   store.load()                       → 目前狀態
 *   store.subscribe(onChange, onConn)  → 狀態變動時通知
 *   store.staff(pin, designer, action, number)
 *   store.owner(pin, action, { designer, day, number, newPin })
 * 叫號規則以 supabase/setup.sql 為準，示範模式照抄同一套規則。
 */
(function () {
  const cfg = window.QC_CONFIG;
  const shopId = cfg.shopId;
  const { taipeiNow } = window.QC;

  // 換日之後、還沒有人按叫號之前，畫面直接當作已歸零
  function normalize(raw) {
    const today = taipeiNow().date;
    const fresh = raw.day !== today;
    const designers = {};
    for (const d of raw.designers) {
      designers[d.id] = fresh ? { status: 'working', number: null }
                              : { status: d.status, number: d.current_number };
    }
    return {
      day: today,
      lastCalled: fresh ? 0 : raw.last_called,
      designers,
      daysOff: raw.days_off.map((o) => ({ designer: o.designer_id, day: o.day })),
    };
  }

  // ===================================================================
  // Supabase
  // ===================================================================
  function createSupabaseStore() {
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false },
    });

    async function load() {
      const from = taipeiNow().date;
      const [s, d, o] = await Promise.all([
        client.from('shops').select('day,last_called').eq('id', shopId).single(),
        client.from('designers').select('id,status,current_number').eq('shop_id', shopId),
        client.from('days_off').select('designer_id,day').eq('shop_id', shopId)
          .gte('day', from).lte('day', QC.addDays(from, 200)),
      ]);
      const err = s.error || d.error || o.error;
      if (err) throw err;
      return normalize({ ...s.data, designers: d.data, days_off: o.data });
    }

    function subscribe(onChange, onConn = () => {}) {
      let timer;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => load().then(onChange).catch(() => onConn('error')), 120);
      };
      // 排休變動時店長函式也會更新 shops，所以監聽兩張表就夠了
      const channel = client.channel(`qc-${shopId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shops', filter: `id=eq.${shopId}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'designers', filter: `shop_id=eq.${shopId}` }, refresh)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { onConn('live'); refresh(); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onConn('error');
        });

      // 手機鎖屏回來時連線可能斷了，回到畫面就重新抓一次；另外每分鐘保底更新
      const onVisible = () => { if (!document.hidden) refresh(); };
      document.addEventListener('visibilitychange', onVisible);
      const poll = setInterval(() => { if (!document.hidden) refresh(); }, 60000);

      return () => {
        client.removeChannel(channel);
        document.removeEventListener('visibilitychange', onVisible);
        clearInterval(poll);
      };
    }

    async function rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      if (error) return { ok: false, message: '連線失敗，請再試一次' };
      return data;
    }

    return {
      mode: 'supabase',
      load,
      subscribe,
      staff: (pin, designer, action, number = null) =>
        rpc('staff_action', { p_shop: shopId, p_pin: pin, p_designer: designer, p_action: action, p_number: number }),
      owner: (pin, action, a = {}) =>
        rpc('owner_action', {
          p_shop: shopId, p_pin: pin, p_action: action, p_designer: a.designer ?? null,
          p_day: a.day ?? null, p_number: a.number ?? null, p_new_pin: a.newPin ?? null,
        }),
    };
  }

  // ===================================================================
  // 示範模式（localStorage）
  // ===================================================================
  function createDemoStore() {
    const KEY = `qc-demo-${shopId}`;
    const listeners = new Set();
    const fmt = QC.pad3;

    function read() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY));
        if (d && d.shop) return d;
      } catch (e) { /* 第一次使用 */ }
      return {
        shop: { day: taipeiNow().date, last_called: 0 },
        designers: Object.fromEntries(cfg.designers.map((d) => [d.id, { status: 'working', current_number: null }])),
        days_off: [],
        log: [],
        pins: { staff: '111111', owner: '999999' },
      };
    }
    function write(db) {
      db.log = db.log.slice(0, 200);
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 私密瀏覽 */ }
      const s = toState(db);
      listeners.forEach((fn) => fn(s));
    }
    function toState(db) {
      return normalize({
        ...db.shop,
        designers: Object.entries(db.designers).map(([id, v]) => ({ id, ...v })),
        days_off: db.days_off,
      });
    }
    function rollDay(db) {
      const today = taipeiNow().date;
      if (db.shop.day !== today) {
        db.shop = { day: today, last_called: 0 };
        for (const d of Object.values(db.designers)) { d.current_number = null; d.status = 'working'; }
      }
    }
    const nameOf = (id) => (cfg.designers.find((d) => d.id === id) || {}).name;
    const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
    const fail = (message) => ({ ok: false, message });

    window.addEventListener('storage', (e) => {
      if (e.key === KEY) { const s = toState(read()); listeners.forEach((fn) => fn(s)); }
    });

    async function staff(pin, designer, action, number = null) {
      const db = read();
      if (pin !== db.pins.staff && pin !== db.pins.owner) return fail('密碼錯誤');
      rollDay(db);
      const s = db.shop;
      if (action === 'ping') return ok('登入成功');
      if (action === 'status') return ok(`目前叫號 ${fmt(s.last_called)}`);
      const d = db.designers[designer];
      if (!d) return fail('找不到這位設計師');
      const name = nameOf(designer);
      const now = Date.now();

      if (action === 'next') {
        const recent = db.log.find((l) => l.designer === designer && !l.undone &&
          (l.action === 'next' || l.action === 'call') && now - l.at < 4000);
        if (recent) return ok(`剛剛已叫 ${fmt(d.current_number)} 號`, { number: d.current_number });
        const n = s.last_called + 1;
        if (n > 999) return fail('號碼已到 999，請店長修改號碼');
        db.log.unshift({ designer, action, number: n, prev: d.current_number, prevLast: s.last_called, at: now, day: s.day });
        s.last_called = n; d.current_number = n; d.status = 'working';
        write(db);
        return ok(`${name} 叫號 ${fmt(n)}`, { number: n });
      }
      if (action === 'call') {
        if (!(number >= 1 && number <= 999)) return fail('請輸入 1～999 的號碼');
        db.log.unshift({ designer, action, number, prev: d.current_number, prevLast: s.last_called, at: now, day: s.day });
        s.last_called = Math.max(s.last_called, number); d.current_number = number; d.status = 'working';
        write(db);
        return ok(`${name} 叫號 ${fmt(number)}`, { number });
      }
      if (action === 'undo') {
        const l = db.log.find((x) => x.designer === designer && !x.undone &&
          (x.action === 'next' || x.action === 'call') && x.day === s.day);
        if (!l) return fail('沒有可以退回的叫號');
        l.undone = true;
        d.current_number = l.prev;
        if (s.last_called === l.number) s.last_called = l.prevLast;
        write(db);
        return ok(`${name} 已退回，目前 ${fmt(l.prev)}`, { number: l.prev });
      }
      if (action === 'break' || action === 'back' || action === 'toggle_break') {
        const a = action === 'toggle_break' ? (d.status === 'break' ? 'back' : 'break') : action;
        d.status = a === 'break' ? 'break' : 'working';
        write(db);
        return ok(`${name}${a === 'break' ? ' 休息中' : ' 回來上工'}`);
      }
      return fail(`不認識的操作：${action}`);
    }

    async function owner(pin, action, a = {}) {
      const db = read();
      if (pin !== db.pins.owner) return fail('密碼錯誤');
      rollDay(db);
      if (action === 'ping') return ok('店長登入成功');
      if (action === 'day_off') {
        if (!db.days_off.some((o) => o.designer_id === a.designer && o.day === a.day)) {
          db.days_off.push({ designer_id: a.designer, day: a.day });
        }
        write(db); return ok('已設定休假');
      }
      if (action === 'day_on') {
        db.days_off = db.days_off.filter((o) => !(o.designer_id === a.designer && o.day === a.day));
        write(db); return ok('已取消休假');
      }
      if (action === 'set_number') {
        if (!(a.number >= 0 && a.number <= 999)) return fail('請輸入 0～999 的號碼');
        db.shop.last_called = a.number; write(db);
        return ok(`目前叫號改為 ${fmt(a.number)}`);
      }
      if (action === 'reset_today') {
        db.shop.last_called = 0;
        for (const d of Object.values(db.designers)) { d.current_number = null; d.status = 'working'; }
        write(db); return ok('已歸零，下一位從 001 開始');
      }
      if (action === 'set_staff_pin' || action === 'set_owner_pin') {
        if (!/^[0-9]{6,12}$/.test(a.newPin || '')) return fail('新密碼請用 6～12 位數字');
        db.pins[action === 'set_staff_pin' ? 'staff' : 'owner'] = a.newPin;
        write(db); return ok('密碼已更新');
      }
      return fail(`不認識的操作：${action}`);
    }

    return {
      mode: 'demo',
      load: async () => toState(read()),
      subscribe(onChange, onConn = () => {}) {
        listeners.add(onChange);
        onConn('live');
        return () => listeners.delete(onChange);
      },
      staff,
      owner,
    };
  }

  const useSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  window.QC.store = useSupabase ? createSupabaseStore() : createDemoStore();
})();
