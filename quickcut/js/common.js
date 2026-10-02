/* 共用小工具：台北時間、號碼格式、設計師狀態 */
(function () {
  const TZ = 'Asia/Taipei';
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  // 不管手機設定哪個時區，一律用台北時間判斷營業、班表
  function taipeiNow(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    return { date: ymd, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
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

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.QC = Object.assign(window.QC || {}, {
    taipeiNow, toMin, pad3, addDays, weekday, shortDate, isOff, shopStatus, designerView, freeDesigners, esc,
  });
})();
