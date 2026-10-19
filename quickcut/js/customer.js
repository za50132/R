/* 客人頁 */
(function () {
  const cfg = window.QC_CONFIG;
  const { store, pad3, esc, taipeiNow, shopStatus, designerView, freeDesigners, waitInfo, waitText, addDays, shortDate,
    waitingTickets, estimateWait, ticketInfo } = window.QC;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let lastHero = null;
  const lastCard = {};

  // 固定資訊
  $('hours').textContent = `每日 ${cfg.shop.open}–${cfg.shop.close}・設計師每月排休`;
  $('address').textContent = cfg.shop.address;
  $('mapLink').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.shop.mapQuery)}`;
  $('phone').textContent = cfg.shop.phone;
  $('telLink').href = `tel:${cfg.shop.phone.replace(/\s/g, '')}`;
  $('myNum').max = cfg.maxNumber || 999;
  if (store.mode === 'demo') $('demoBanner').hidden = false;

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth; // 重新觸發動畫
    el.classList.add('bump');
  }

  function render() {
    if (!state) return;
    const now = taipeiNow();
    const open = shopStatus(cfg, now);
    $('openLabel').textContent = open.label;
    $('openDot').classList.toggle('closed', !open.open);

    // 目前叫號
    const hero = $('heroNum');
    const n = state.lastCalled;
    hero.textContent = pad3(n);
    hero.classList.toggle('idle', !n);
    const tracking = state.lastIssued > 0;      // 今天有在用「加號」，系統知道排隊名單
    const waitingCount = waitingTickets(state).length;
    $('heroSub').textContent = tracking ? `已發到 ${pad3(state.lastIssued)} 號・等候 ${waitingCount} 人`
      : n ? '請對照您的號碼牌' : (open.open ? '今天還沒開始叫號' : '休息中，明天見');
    if (lastHero !== null && n !== lastHero) bump(hero);
    lastHero = n;

    // 設計師
    $('designers').innerHTML = cfg.designers.map((d) => {
      const v = designerView(d, state, now);
      const body = v.number
        ? `<div class="dcard-num num" data-id="${d.id}">${pad3(v.number)}</div>`
        : `<div class="dcard-big-label">${v.kind === 'off' ? '休假' : v.kind === 'away' ? '不在店' : '—'}</div>`;
      const queued = waitingTickets(state, d.id).length;
      return `<article class="dcard ${v.kind}">
        <div class="dcard-head"><span class="dcard-name">${esc(d.name)}</span><span class="dcard-role">${esc(d.role === '店長' ? '店長' : d.shift)}</span></div>
        <div class="dcard-state"><span class="dot"></span>${esc(v.label)}</div>
        ${queued ? `<div class="dcard-queue">等候 ${queued} 人</div>` : ''}
        ${body}
      </article>`;
    }).join('');
    for (const d of cfg.designers) {
      const num = (designerView(d, state, now).number) || null;
      const el = document.querySelector(`.dcard-num[data-id="${d.id}"]`);
      if (el && d.id in lastCard && lastCard[d.id] !== num) bump(el);
      lastCard[d.id] = num;
    }

    // 預估等候：當班人員有評估就用評估；沒有的話，依排隊人數自動估算
    const w = open.open ? waitInfo(state) : null;
    const manual = Boolean(w && w.fresh);
    const auto = !manual && open.open && tracking ? estimateWait(cfg, state, now) : null;
    const minutes = manual ? w.minutes : auto;
    $('wait').hidden = minutes == null;
    if (minutes != null) {
      $('waitValue').textContent = waitText(minutes);
      $('wait').classList.toggle('short', minutes <= 10);
      $('wait').classList.toggle('long', minutes >= 30);
    }

    // 現在人少：人員評估 > 排隊名單 > 設計師多久沒叫號
    const free = freeDesigners(cfg, state, now);
    const quiet = manual ? w.minutes <= 5 : tracking ? waitingCount === 0 && free > 0 : free > 0;
    $('quiet').hidden = !quiet;
    $('quietSub').textContent = !quiet ? '' : manual ? '店內人員剛評估：現在免等'
      : tracking ? `沒有人在排隊・${free} 位設計師空檔中` : `目前有 ${free} 位設計師空檔中`;

    renderMine(now);

    // 近期休假（14 天內）
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const day = addDays(now.date, i);
      const names = cfg.designers.filter((d) => state.daysOff.some((o) => o.designer === d.id && o.day === day)).map((d) => d.name);
      if (names.length) rows.push(`<li><span class="date">${i === 0 ? '今天' : i === 1 ? '明天' : shortDate(day)}</span><span class="names">${names.map(esc).join('、')} 休假</span></li>`);
    }
    $('offList').innerHTML = rows.length ? rows.join('') : '<li class="empty">未來兩週設計師都有上班</li>';
  }

  // ===== 客人頁使用量（匿名）=====
  // 每台手機每天一個隨機代號，只用來算「幾個人」，隔天就換，不能追蹤到人
  function visitorId() {
    const today = taipeiNow().date;
    try {
      const v = JSON.parse(localStorage.getItem('qc-vid'));
      if (v && v.day === today) return v.id;
    } catch (e) { /* 無痕視窗 */ }
    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem('qc-vid', JSON.stringify({ day: today, id })); } catch (e) { /* 無痕視窗 */ }
    return id;
  }
  const PARAMS = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } })();
  const SRC = PARAMS.get('src');
  // 不算進使用量的瀏覽：
  //   ・自動化測試的瀏覽器（navigator.webdriver）和搜尋引擎、連結預覽之類的機器人
  //   ・店內手機（登入過操作頁）
  //   ・自己人的手機或電腦：打開一次 ?internal=1 就記住，?internal=0 取消
  const INTERNAL_KEY = 'qc-internal';
  try {
    if (PARAMS.get('internal') === '1') localStorage.setItem(INTERNAL_KEY, '1');
    if (PARAMS.get('internal') === '0') localStorage.removeItem(INTERNAL_KEY);
  } catch (e) { /* 無痕視窗 */ }
  const NOT_COUNTED = (() => {
    if (navigator.webdriver) return true;
    if (/bot|crawl|spider|slurp|preview|lighthouse|headless|facebookexternalhit|line-poker/i.test(navigator.userAgent || '')) return true;
    try {
      return Boolean(localStorage.getItem(INTERNAL_KEY) || localStorage.getItem(`qc-staff-${cfg.shopId}`));
    } catch (e) { return false; }
  })();
  const logView = (kind) => {
    if (NOT_COUNTED) return;
    try { store.logView(kind, visitorId(), SRC); } catch (e) { /* 不影響畫面 */ }
  };
  logView('open');

  // ===== 查我的號碼 =====
  const MINE_KEY = `qc-mine-${cfg.shopId}`;
  let mine = null;     // { day, number }
  let lastMineKind = null;
  try { mine = JSON.parse(localStorage.getItem(MINE_KEY)); } catch (e) { /* 私密瀏覽 */ }

  $('myForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = parseInt($('myNum').value, 10);
    if (!(n >= 1 && n <= 999)) return;
    mine = { day: taipeiNow().date, number: n };
    lastMineKind = null;
    logView('lookup');
    try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch (err) { /* 私密瀏覽 */ }
    $('myNum').blur();
    render();
  });

  function renderMine(now) {
    // 今天有用「加號」才知道排隊名單，才顯示查詢
    $('myCard').hidden = !(state.lastIssued > 0);
    const box = $('myResult');
    if (!mine || mine.day !== now.date || $('myCard').hidden) { box.textContent = ''; return; }
    if (document.activeElement !== $('myNum')) $('myNum').value = mine.number;
    const info = ticketInfo(cfg, state, mine.number, now);
    const name = (id) => (cfg.designers.find((d) => d.id === id) || {}).name || '';
    const num = `<b class="num">${pad3(mine.number)}</b> 號`;
    let html;
    if (info.kind === 'serving') html = `🎉 ${num} 輪到您了！請找 <b>${esc(name(info.by))}</b>`;
    else if (info.kind === 'waiting') {
      const who = info.designer ? `${info.assigned ? '指派' : '指定'} ${esc(name(info.designer))}・` : '';
      const eta = info.minutes == null ? '設計師目前不在或休息中' : `預估等候 ${waitText(info.minutes)}`;
      html = `${num}　${who}前面還有 <b>${info.ahead}</b> 位<br><small>${esc(eta)}</small>`;
    } else if (info.kind === 'done') html = `${num} 已完成服務，謝謝光臨`;
    else if (info.kind === 'skipped') html = `${num} 已過號<br><small>回來後要再等 ${cfg.skipRejoinAfter || 3} 位，請跟店內人員說一聲</small>`;
    else if (info.kind === 'cancelled') html = `${num} 已取消`;
    else if (info.kind === 'unknown') html = `還沒發到 ${num}，請確認號碼牌`;
    else html = `查不到 ${num}`;
    box.innerHTML = html;
    box.classList.toggle('turn', info.kind === 'serving');
    box.classList.toggle('muted', !['serving', 'waiting'].includes(info.kind));
    if (info.kind === 'serving' && lastMineKind && lastMineKind !== 'serving') {
      try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* iOS 不支援 */ }
    }
    lastMineKind = info.kind;
  }

  function setLive(s) {
    $('live').classList.toggle('err', s === 'error');
    $('liveLabel').textContent = s === 'error' ? '重新連線中…' : '即時更新';
  }

  store.load().then((s) => { state = s; render(); }).catch(() => setLive('error'));
  store.subscribe((s) => { state = s; setLive('live'); render(); }, setLive);
  // 上下班、營業時間會隨時間改變
  setInterval(render, 30000);
})();
