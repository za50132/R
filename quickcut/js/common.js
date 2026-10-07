/* 共用小工具：台北時間、號碼格式、設計師狀態 */
(function () {
  const TZ = 'Asia/Taipei';
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // 預覽用：示範模式下可以用網址 ?t=15:00 指定時間，讓打烊後也看得到營業中的畫面
  const PREVIEW_MIN = (() => {
    try {
      if (window.QC_CONFIG && window.QC_CONFIG.supabaseUrl) return null;
      const m = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('t') || '');
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    } catch (e) { return null; }
  })();

  // 不管手機設定哪個時區，一律用台北時間判斷營業、班表
  function taipeiNow(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return { date: ymd, minutes: PREVIEW_MIN ?? minutes };
  }

  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const pad3 = (n) => (n == null || n === 0 ? '---' : String(n).padStart(3, '0'));

  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function weekday(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  const shortDate = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}（${weekday(ymd)}）`;

  function isOff(state, designerId, ymd) {
    return state.daysOff.some((o) => o.designer === designerId && o.day === ymd);
  }

  function shopStatus(cfg, now = taipeiNow()) {
    const open = toMin(cfg.shop.open), close = toMin(cfg.shop.close);
    if (now.minutes < open) return { open: false, label: `今日 ${cfg.shop.open} 開門` };
    if (now.minutes >= close) return { open: false, label: `今日已打烊・明天 ${cfg.shop.open} 開門` };
    return { open: true, label: `營業中・${cfg.shop.open}–${cfg.shop.close}` };
  }

  // 設計師在客人眼中的狀態
  //   free = true 代表「應該空檔中」：在班、沒休息、而且超過 idleMinutes 沒叫號
  function designerView(d, state, now = taipeiNow()) {
    const live = state.designers[d.id] || { status: 'working', number: null, calledAt: null };
    if (isOff(state, d.id, now.date)) return { kind: 'off', label: '今日休假', number: null };
    if (now.minutes < toMin(d.start)) return { kind: 'away', label: `${d.start} 上班`, number: null };
    if (now.minutes >= toMin(d.end)) return { kind: 'away', label: '已下班', number: null };
    if (live.status === 'break') return { kind: 'break', label: '休息中', number: live.number };

    const idleMinutes = (window.QC_CONFIG && window.QC_CONFIG.idleMinutes) || 20;
    const sinceCall = live.calledAt ? (Date.now() - live.calledAt) / 60000 : null;
    if (live.number && (sinceCall === null || sinceCall < idleMinutes)) {
      return { kind: 'cutting', label: '服務中', number: live.number };
    }
    // 剛上班的 15 分鐘內不算空檔：開門時門口可能已經有人在等，只是還沒按叫號
    if (now.minutes - toMin(d.start) < 15) return { kind: 'idle', label: '上班中', number: live.number };
    return { kind: 'idle', label: '空檔中', number: live.number, free: true };
  }

  // 現在有幾位設計師空檔中（只在營業時間內計算）
  function freeDesigners(cfg, state, now = taipeiNow()) {
    if (!state || !shopStatus(cfg, now).open) return 0;
    return cfg.designers.filter((d) => designerView(d, state, now).free).length;
  }

  // 當班人員評估的等候時間：太久沒更新就視為無效
  const WAIT_FRESH = () => (window.QC_CONFIG && window.QC_CONFIG.waitFreshMinutes) || 60;
  function waitInfo(state) {
    if (!state || state.waitMinutes == null || !state.waitSetAt) return null;
    const ago = Math.max(0, Math.floor((Date.now() - state.waitSetAt) / 60000));
    return { minutes: state.waitMinutes, ago, fresh: ago < WAIT_FRESH() };
  }
  const waitText = (n) => (n <= 0 ? '免等' : n >= 60 ? '60 分鐘以上' : `約 ${n} 分鐘`);
  const agoText = (m) => (m < 1 ? '剛剛更新' : m < 60 ? `${m} 分鐘前更新` : `${Math.floor(m / 60)} 小時前更新`);

  // ===== 排隊 =====
  const AVG = () => (window.QC_CONFIG && window.QC_CONFIG.avgCutMinutes) || 12;
  const waitingTickets = (state, who) =>
    (state.tickets || []).filter((t) => t.status === 'waiting' && (who === undefined || t.designer === who));

  // 現在能剪的設計師：在班、沒休假、沒休息
  function activeDesigners(cfg, state, now = taipeiNow()) {
    return cfg.designers.filter((d) => ['cutting', 'idle'].includes(designerView(d, state, now).kind));
  }
  const round5 = (m) => Math.max(0, Math.round(m / 5) * 5);

  // 現在抽號（不指定）大約要等幾分鐘；沒人能剪時回傳 null
  function estimateWait(cfg, state, now = taipeiNow()) {
    const active = activeDesigners(cfg, state, now);
    if (!active.length) return null;
    const ahead = waitingTickets(state).length;
    if (!ahead && freeDesigners(cfg, state, now) > 0) return 0;
    // 大家都在剪：平均還要再等半個人的時間才會空出一位
    return round5(((ahead + 0.5) * AVG()) / active.length);
  }

  // 查某一號：前面還有幾位、大約幾分鐘
  function ticketInfo(cfg, state, number, now = taipeiNow()) {
    const t = (state.tickets || []).find((x) => x.number === number);
    if (!t) return number > (state.lastIssued || 0) ? { kind: 'unknown' } : { kind: 'gone' };
    if (t.status === 'serving') return { kind: 'serving', by: t.servedBy };
    if (t.status !== 'waiting') return { kind: t.status };
    const active = activeDesigners(cfg, state, now);
    if (t.designer) {
      // state.tickets 已依排隊順序排好（過號回來的會排在後面）
      const ahead = waitingTickets(state, t.designer).findIndex((x) => x.number === number);
      const on = active.some((d) => d.id === t.designer);
      return { kind: 'waiting', ahead, designer: t.designer, minutes: on ? round5((ahead + 0.5) * AVG()) : null };
    }
    const ahead = waitingTickets(state).findIndex((x) => x.number === number);
    return { kind: 'waiting', ahead, minutes: active.length ? round5(((ahead + 0.5) * AVG()) / active.length) : null };
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.QC = Object.assign(window.QC || {}, {
    taipeiNow, toMin, pad3, addDays, weekday, shortDate, isOff, shopStatus, designerView, freeDesigners,
    waitInfo, waitText, agoText, esc, waitingTickets, activeDesigners, estimateWait, ticketInfo,
  });
})();
