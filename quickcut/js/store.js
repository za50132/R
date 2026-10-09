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

  // 換日之後、還沒有人操作之前，畫面直接當作已歸零
  function normalize(raw) {
    const today = taipeiNow().date;
    const fresh = raw.day !== today;
    const designers = {};
    for (const d of raw.designers) {
      designers[d.id] = fresh ? { status: 'working', number: null, calledAt: null }
                              : { status: d.status, number: d.current_number,
                                  calledAt: d.called_at ? Date.parse(d.called_at) : null };
    }
    return {
      day: today,
      lastCalled: fresh ? 0 : raw.last_called,
      lastIssued: fresh ? 0 : raw.last_issued || 0,
      waitMinutes: fresh ? null : raw.wait_minutes ?? null,
      waitSetAt: fresh || !raw.wait_set_at ? null : Date.parse(raw.wait_set_at),
      designers,
      // 依排隊順序排好：一般照號碼，過號回來的客人插在後面 3 位之後
      tickets: fresh ? [] : (raw.tickets || [])
        .map((t) => ({ number: t.number, designer: t.designer_id, assigned: Boolean(t.assigned), status: t.status, servedBy: t.served_by,
                       order: t.sort_key != null ? Number(t.sort_key) : t.number }))
        .sort((a, b) => a.order - b.order || a.number - b.number),
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
      const [s, d, o, t] = await Promise.all([
        client.from('shops').select('day,last_called,last_issued,wait_minutes,wait_set_at').eq('id', shopId).single(),
        client.from('designers').select('id,status,current_number,called_at').eq('shop_id', shopId),
        client.from('days_off').select('designer_id,day').eq('shop_id', shopId)
          .gte('day', from).lte('day', QC.addDays(from, 200)),
        client.from('tickets').select('*').eq('shop_id', shopId).eq('day', from),
      ]);
      const err = s.error || d.error || o.error || t.error;
      if (err) throw err;
      return normalize({ ...s.data, designers: d.data, days_off: o.data, tickets: t.data });
    }

    function subscribe(onChange, onConn = () => {}) {
      let timer;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => load().then(onChange).catch(() => onConn('error')), 120);
      };
      // 加號、叫號、排休等所有操作都會更新 shops，所以監聽兩張表就夠了
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

    async function crowdStats() {
      const { data, error } = await client.rpc('crowd_stats', { p_shop: shopId });
      if (error) throw error;
      return data;
    }

    // 客人頁使用量：失敗也不影響畫面，所以不等結果、不報錯
    function logView(kind, visitor, src) {
      client.rpc('log_view', { p_shop: shopId, p_kind: kind, p_visitor: visitor, p_src: src || null })
        .then(() => {}, () => {});
    }

    return {
      mode: 'supabase',
      load,
      subscribe,
      crowdStats,
      logView,
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
    const iso = (ms = Date.now()) => new Date(ms).toISOString();

    function blank() {
      return {
        shop: { day: taipeiNow().date, last_called: 0, last_issued: 0, wait_minutes: null, wait_set_at: null },
        designers: Object.fromEntries(cfg.designers.map((d) => [d.id, { status: 'working', current_number: null, called_at: null }])),
        tickets: [],
        days_off: [],
        log: [],
        pins: { staff: '111111', owner: '999999' },
      };
    }
    function read() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY));
        if (d && d.shop) { d.tickets = d.tickets || []; d.shop.last_issued = d.shop.last_issued || 0; return d; }
      } catch (e) { /* 第一次使用 */ }
      return blank();
    }
    function emit(db) { const s = toState(db); listeners.forEach((fn) => fn(s)); }
    function write(db) {
      db.log = db.log.slice(0, 300);
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 私密瀏覽 */ }
      emit(db);
    }
    function toState(db) {
      return normalize({
        ...db.shop,
        designers: Object.entries(db.designers).map(([id, v]) => ({ id, ...v })),
        tickets: db.tickets,
        days_off: db.days_off,
      });
    }
    function rollDay(db) {
      const today = taipeiNow().date;
      if (db.shop.day !== today) {
        db.shop = { day: today, last_called: 0, last_issued: 0, wait_minutes: null, wait_set_at: null };
        db.tickets = [];
        for (const d of Object.values(db.designers)) { d.current_number = null; d.called_at = null; d.status = 'working'; }
      }
    }
    const nameOf = (id) => (cfg.designers.find((d) => d.id === id) || {}).name;
    const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
    const fail = (message) => ({ ok: false, message });
    const ticket = (db, n) => db.tickets.find((t) => t.number === n);
    // 排隊順序：一般照號碼，過號回來的客人用 sort_key 插隊到後面 3 位之後
    const key = (t) => (t.sort_key != null ? t.sort_key : t.number);
    const queue = (db) => db.tickets.filter((t) => t.status === 'waiting').sort((a, b) => key(a) - key(b) || a.number - b.number);
    const waiting = (db, who) => db.tickets.filter((t) => t.status === 'waiting' && (!who || t.designer_id === who)).length;
    function fillTo(db, upto) {
      const from = Math.max(db.shop.last_issued, ...db.tickets.map((t) => t.number), 0) + 1;
      for (let n = from; n <= upto; n++) {
        db.tickets.push({ number: n, designer_id: null, status: 'waiting', served_by: null, issued_at: iso() });
      }
      db.shop.last_issued = Math.max(db.shop.last_issued, upto);
      return Math.max(0, upto - from + 1);
    }

    window.addEventListener('storage', (e) => { if (e.key === KEY) emit(read()); });

    async function staff(pin, designer, action, number = null) {
      const db = read();
      if (pin !== db.pins.staff && pin !== db.pins.owner) return fail('密碼錯誤');
      rollDay(db);
      const s = db.shop;
      if (action === 'ping') return ok('登入成功');
      if (action === 'status') {
        const lines = cfg.designers.map((x) => {
          const v = db.designers[x.id];
          const w = waiting(db, x.id);
          return `${x.name}：${v.status === 'break' ? '休息' : fmt(v.current_number)}${w ? `（指定等 ${w}）` : ''}`;
        });
        return ok([`叫號 ${fmt(s.last_called)}・已發 ${fmt(s.last_issued)}・等 ${waiting(db)} 人`, ...lines].join('\n'));
      }
      if (action === 'set_wait') {
        if (!(number >= 0 && number <= 180)) return fail('請輸入 0～180 分鐘');
        s.wait_minutes = number; s.wait_set_at = iso();
        write(db);
        return ok(`等候時間：${QC.waitText(number)}`);
      }

      // ===== 加號 =====
      if (['issue', 'assign', 'dispatch'].includes(action) && designer && !db.designers[designer]) return fail('找不到這位設計師');
      const who = designer ? nameOf(designer) : null;
      if (action === 'issue') {
        const n = Math.max(s.last_issued, ...db.tickets.map((t) => t.number), 0) + 1;
        if (n > 999) return fail('號碼已到 999，請店長歸零');
        db.tickets.push({ number: n, designer_id: designer || null, status: 'waiting', served_by: null, issued_at: iso() });
        s.last_issued = n;
        write(db);
        return ok(`加號 ${fmt(n)}${who ? `（指定 ${who}）` : ''}・等 ${waiting(db)} 人`, { number: n });
      }
      if (action === 'issue_to') {
        if (!(number >= 1 && number <= 999)) return fail('請輸入 1～999 的號碼');
        if (number <= s.last_issued) return ok(`已經發到 ${fmt(s.last_issued)} 號，不用補`);
        const added = fillTo(db, number);
        write(db);
        return ok(`已補到 ${fmt(number)} 號（新增 ${added} 號）`, { number });
      }
      if (action === 'undo_issue') {
        const t = ticket(db, s.last_issued);
        if (!t || t.status !== 'waiting') return fail(`最後一號 ${fmt(s.last_issued)} 已經叫過，不能取消`);
        db.tickets = db.tickets.filter((x) => x !== t);
        s.last_issued -= 1;
        write(db);
        return ok(`已取消 ${fmt(t.number)} 號`);
      }
      if (action === 'assign' || action === 'dispatch' || action === 'cancel_ticket') {
        const t = ticket(db, number);
        if (!t || !(t.status === 'waiting' || (action === 'cancel_ticket' && t.status === 'skipped'))) {
          return fail(`${fmt(number)} 號不在等候名單`);
        }
        let msg;
        if (action === 'assign') {
          t.designer_id = designer || null; t.assigned = false;
          msg = `${fmt(number)} 號改為${who ? `指定 ${who}` : '不指定'}`;
        } else if (action === 'dispatch') {
          // 指派：只能用在不指定（或已指派）的客人，客人自己指定的不能改
          if (t.designer_id && !t.assigned) return fail(`${fmt(number)} 號是客人指定的，不能指派`);
          t.designer_id = designer || null; t.assigned = Boolean(designer);
          msg = `${fmt(number)} 號${who ? `指派給 ${who}` : '改回不指定'}`;
        }
        else { t.status = 'cancelled'; msg = `已取消 ${fmt(number)} 號`; }
        write(db);
        return ok(msg);
      }
      if (action === 'rejoin') {
        const t = ticket(db, number);
        if (!t || t.status !== 'skipped') return fail(`${fmt(number)} 號不是過號的號碼`);
        // 過號要等 3 位：插在目前等候第 3 位和第 4 位中間（不到 3 位就排最後）
        const keys = queue(db).map(key);
        const after = cfg.skipRejoinAfter || 3;
        const k = keys.length >= after ? keys[after - 1] : keys.length ? keys[keys.length - 1] : 0;
        const k2 = keys.find((x) => x > k);
        Object.assign(t, { status: 'waiting', served_by: null, sort_key: k2 == null ? k + 1 : (k + k2) / 2 });
        write(db);
        const w = waiting(db);
        return ok(`${fmt(number)} 號回來了，${w <= 1 ? '下一位就輪到他' : `排在 ${Math.min(after, w - 1)} 位後面`}`);
      }

      // ===== 叫號 =====
      const d = db.designers[designer];
      if (!d) return fail('找不到這位設計師');
      const name = nameOf(designer);
      const now = Date.now();
      const prev = d.current_number;
      const serving = () => db.tickets.find((t) => t.status === 'serving' && t.served_by === designer);
      const take = (n) => {
        const t = ticket(db, n);
        t.status = 'serving'; t.served_by = designer;
        s.last_called = n; d.current_number = n; d.called_at = iso(now); d.status = 'working';
        return t;
      };

      if (action === 'next' || action === 'skip') {
        const recent = db.log.find((l) => l.designer === designer && !l.undone && l.day === s.day &&
          ['next', 'skip', 'call'].includes(l.action) && now - l.at < 4000);
        if (action === 'next' && recent) return ok(`剛剛已叫 ${fmt(d.current_number)} 號`, { number: d.current_number });

        const cur = serving();
        if (cur) cur.status = action === 'skip' ? 'skipped' : 'done';
        // 先叫「指定我」的，沒有再叫「不指定」的，都照號碼順序（tickets 依號碼排序）
        const q = queue(db);
        const pick = q.find((t) => t.designer_id === designer) || q.find((t) => !t.designer_id);
        db.log.unshift({ designer, action, number: pick ? pick.number : null, prev, prevLast: s.last_called, at: now, day: s.day });
        if (!pick) {
          d.current_number = null; d.called_at = iso(now); d.status = 'working';
          write(db);
          return ok(`${action === 'skip' ? `已過號 ${fmt(prev)}・` : ''}目前沒有人等候`, { number: null });
        }
        take(pick.number);
        write(db);
        return ok(`${action === 'skip' ? '過號・' : ''}${name} 叫 ${fmt(pick.number)}${pick.assigned ? '（指派）' : pick.designer_id ? '（指定）' : ''}・等 ${waiting(db)} 人`,
          { number: pick.number });
      }
      if (action === 'call') {
        if (!(number >= 1 && number <= 999)) return fail('請輸入 1～999 的號碼');
        if (number > s.last_issued) fillTo(db, number);
        const t = ticket(db, number);
        if (t.status === 'serving' && t.served_by !== designer) return fail(`${fmt(number)} 號正在由 ${nameOf(t.served_by)} 服務`);
        const cur = serving();
        if (cur && cur.number !== number) cur.status = 'done';
        db.log.unshift({ designer, action, number, prev, prevLast: s.last_called, at: now, day: s.day });
        take(number);
        write(db);
        return ok(`${name} 叫 ${fmt(number)}`, { number });
      }
      if (action === 'undo') {
        const l = db.log.find((x) => x.designer === designer && !x.undone &&
          ['next', 'skip', 'call'].includes(x.action) && x.day === s.day);
        if (!l) return fail('沒有可以退回的叫號');
        l.undone = true;
        const t = l.number != null && ticket(db, l.number);
        if (t && t.served_by === designer) { t.status = 'waiting'; t.served_by = null; }
        const p = l.prev != null && ticket(db, l.prev);
        if (p && (p.status === 'done' || p.status === 'skipped')) { p.status = 'serving'; p.served_by = designer; }
        d.current_number = l.prev;
        const before = db.log.find((x) => x.designer === designer && !x.undone &&
          ['next', 'skip', 'call'].includes(x.action) && x.day === s.day);
        d.called_at = before ? iso(before.at) : null;
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
        const keepPins = db.pins, keepOff = db.days_off;
        const fresh = blank();
        fresh.pins = keepPins; fresh.days_off = keepOff;
        write(fresh); return ok('已歸零，下一位從 001 開始');
      }
      if (action === 'set_staff_pin' || action === 'set_owner_pin') {
        if (!/^[0-9]{6,12}$/.test(a.newPin || '')) return fail('新密碼請用 6～12 位數字');
        db.pins[action === 'set_staff_pin' ? 'staff' : 'owner'] = a.newPin;
        write(db); return ok('密碼已更新');
      }
      return fail(`不認識的操作：${action}`);
    }

    // 示範模式沒有歷史紀錄，用一組「常見快剪人潮」假資料讓畫面看得出效果
    async function crowdStats() {
      const weekday = [3, 5, 7, 9, 8, 4, 3, 4, 7, 10, 11, 9, 6, 2];   // 09 點～22 點
      const weekend = [6, 9, 11, 12, 11, 9, 8, 9, 10, 11, 10, 8, 5, 2];
      const hours = [];
      for (let dow = 0; dow < 7; dow++) {
        const base = dow === 0 || dow === 6 ? weekend : weekday;
        base.forEach((v, i) => hours.push({ dow, hour: 9 + i, avg: Math.round(v * (dow === 5 ? 1.15 : 1) * 10) / 10 }));
      }
      return { days: 56, hours, demo: true };
    }

    // 預覽用：清空、或載入「下午有人排隊」的範例情境
    function demoReset() { write(blank()); }
    async function demoSeed() {
      const db = blank();
      write(db);
      const pin = db.pins.staff;
      for (const who of [null, null, 'tim', null, 'jiang', null, null, 'tim', null]) await staff(pin, who, 'issue');
      for (const who of ['jiang', 'chien', 'tim', 'katie']) {
        const x = read(); x.log = []; write(x);       // 範例資料不觸發連點保護
        await staff(pin, who, 'next');
      }
      const x = read();
      x.log = [];
      // 讓叫號時間分散一點，看起來比較像真的
      Object.values(x.designers).forEach((v, i) => { if (v.called_at) v.called_at = iso(Date.now() - (3 + i * 4) * 60000); });
      write(x);
    }

    return {
      mode: 'demo',
      crowdStats,
      logView() { /* 示範模式不記錄 */ },
      load: async () => toState(read()),
      subscribe(onChange, onConn = () => {}) {
        listeners.add(onChange);
        onConn('live');
        return () => listeners.delete(onChange);
      },
      staff,
      owner,
      demoReset,
      demoSeed,
    };
  }

  const useSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  window.QC.store = useSupabase ? createSupabaseStore() : createDemoStore();
})();
