/*
 * 共用：台北時間、格式、資料同步。
 * 有 Supabase 設定就連雲端；沒有就是「示範模式」（存在這台電腦的瀏覽器）。
 * 叫號規則以 supabase/setup.sql 為準，示範模式照抄同一套。
 */
(function () {
  const cfg = window.PG_CONFIG;
  const TZ = 'Asia/Taipei';
  const demo = !(cfg.supabaseUrl && cfg.supabaseKey);

  // 示範模式可以用網址 ?t=15:00 指定時間，讓打烊後也看得到營業中的畫面
  const PREVIEW_MIN = (() => {
    try {
      if (!demo) return null;
      const m = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('t') || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    } catch (e) { return null; }
  })();

  function taipeiNow() {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: PREVIEW_MIN ?? Number(p.hour) * 60 + Number(p.minute) };
  }
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const pad3 = (n) => (!n ? '---' : String(n).padStart(3, '0'));
  const waitText = (n) => (n <= 0 ? '免等' : n >= 60 ? '60 分鐘以上' : `約 ${n} 分鐘`);
  const agoText = (m) => (m < 1 ? '剛剛更新' : m < 60 ? `${m} 分鐘前更新` : `${Math.floor(m / 60)} 小時前更新`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function shopStatus(now = taipeiNow()) {
    const open = toMin(cfg.shop.open), close = toMin(cfg.shop.close);
    if (now.minutes < open) return { open: false, label: `今日 ${cfg.shop.open} 開門` };
    if (now.minutes >= close) return { open: false, label: `今日已打烊・明天 ${cfg.shop.open} 開門` };
    return { open: true, label: `營業中・${cfg.shop.open}–${cfg.shop.close}` };
  }

  // 老闆輸入的等待時間：太久沒更新就不算數
  function waitInfo(state) {
    if (!state || state.waitMinutes == null || !state.waitSetAt) return null;
    const ago = Math.max(0, Math.floor((Date.now() - state.waitSetAt) / 60000));
    return { minutes: state.waitMinutes, ago, fresh: ago < (cfg.waitFreshMinutes || 60) };
  }

  // 換日之後、老闆還沒按之前，畫面直接當作已歸零
  function normalize(raw) {
    const fresh = !raw || raw.day !== taipeiNow().date;
    return {
      current: fresh ? 0 : raw.current,
      prev: fresh ? null : raw.prev,
      waitMinutes: fresh ? null : raw.wait_minutes ?? null,
      waitSetAt: fresh || !raw.wait_set_at ? null : Date.parse(raw.wait_set_at),
    };
  }

  // ===================================================================
  // Supabase
  // ===================================================================
  function supabaseStore() {
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false } });
    async function load() {
      const { data, error } = await client.from('pager').select('day,current,prev,wait_minutes,wait_set_at')
        .eq('shop_id', cfg.shopId).single();
      if (error) throw error;
      return normalize(data);
    }
    function subscribe(onChange, onConn = () => {}) {
      let timer;
      const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => load().then(onChange).catch(() => onConn('error')), 100);
      };
      const channel = client.channel(`pg-${cfg.shopId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pager', filter: `shop_id=eq.${cfg.shopId}` }, refresh)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { onConn('live'); refresh(); }
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) onConn('error');
        });
      // 手機鎖屏回來時連線可能斷了：回到畫面就重新抓，另外每 30 秒保底更新
      const onVisible = () => { if (!document.hidden) refresh(); };
      document.addEventListener('visibilitychange', onVisible);
      const poll = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
      return () => { client.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible); clearInterval(poll); };
    }
    async function act(pin, action, number = null, newPin = null) {
      const { data, error } = await client.rpc('pager_action', {
        p_shop: cfg.shopId, p_pin: pin, p_action: action, p_number: number, p_new_pin: newPin,
      });
      return error ? { ok: false, message: '連線失敗，請再試一次' } : data;
    }
    return { mode: 'supabase', load, subscribe, act };
  }

  // ===================================================================
  // 示範模式（localStorage）
  // ===================================================================
  function demoStore() {
    const KEY = `pg-demo-${cfg.shopId}`;
    const listeners = new Set();
    const blank = () => ({ day: taipeiNow().date, current: 0, prev: null, wait_minutes: null, wait_set_at: null,
      last_action: null, updated_at: 0, pin: '111111' });
    function read() {
      try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.pin) return d; } catch (e) { /* 第一次使用 */ }
      return blank();
    }
    function write(d) {
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 無痕視窗 */ }
      const s = normalize(d);
      listeners.forEach((fn) => fn(s));
    }
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) { const s = normalize(read()); listeners.forEach((fn) => fn(s)); }
    });
    const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
    const fail = (message) => ({ ok: false, message });

    async function act(pin, action, number = null, newPin = null) {
      const d = read();
      if (pin !== d.pin) return fail('密碼錯誤');
      if (d.day !== taipeiNow().date) Object.assign(d, blank(), { pin: d.pin });
      const now = Date.now();
      if (action === 'ping') return ok('登入成功');
      if (action === 'next') {
        if (d.last_action === 'next' && now - d.updated_at < 3000) return ok(`剛剛已叫 ${pad3(d.current)} 號`, { number: d.current });
        if (d.current >= 999) return fail('號碼已到 999');
        Object.assign(d, { prev: d.current, current: d.current + 1, last_action: 'next', updated_at: now });
        write(d); return ok(`叫號 ${pad3(d.current)}`, { number: d.current });
      }
      if (action === 'call') {
        if (!(number >= 1 && number <= 999)) return fail('請輸入 1～999 的號碼');
        Object.assign(d, { prev: d.current, current: number, last_action: 'call', updated_at: now });
        write(d); return ok(`叫號 ${pad3(number)}`, { number });
      }
      if (action === 'undo') {
        if (d.prev == null) return fail('沒有可以退回的號碼');
        Object.assign(d, { current: d.prev, prev: null, last_action: 'undo', updated_at: now });
        write(d); return ok(`已退回 ${pad3(d.current)}`, { number: d.current });
      }
      if (action === 'set_wait') {
        if (!(number >= 0 && number <= 180)) return fail('請輸入 0～180 分鐘');
        Object.assign(d, { wait_minutes: number, wait_set_at: new Date(now).toISOString(), last_action: 'set_wait', updated_at: now });
        write(d); return ok(`等待時間：${waitText(number)}`);
      }
      if (action === 'set_pin') {
        if (!/^[0-9]{6,12}$/.test(newPin || '')) return fail('新密碼請用 6～12 位數字');
        d.pin = newPin; write(d); return ok('密碼已更新');
      }
      return fail(`不認識的操作：${action}`);
    }

    return {
      mode: 'demo',
      load: async () => normalize(read()),
      subscribe(onChange, onConn = () => {}) { listeners.add(onChange); onConn('live'); return () => listeners.delete(onChange); },
      act,
      demoReset() { write(blank()); },
      demoSet(current, waitMinutes) {
        const d = read();
        Object.assign(d, { day: taipeiNow().date, current, prev: null, last_action: null,
          wait_minutes: waitMinutes, wait_set_at: waitMinutes == null ? null : new Date().toISOString() });
        write(d);
      },
    };
  }

  window.PG = {
    cfg, demo, taipeiNow, pad3, waitText, agoText, esc, shopStatus, waitInfo,
    store: demo || !window.supabase ? demoStore() : supabaseStore(),
  };
})();
