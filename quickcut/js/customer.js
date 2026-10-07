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
  $('shopName').textContent = cfg.shop.name;
  $('shopEn').textContent = cfg.shop.nameEn;
  $('hours').textContent = `每日 ${cfg.shop.open}–${cfg.shop.close}・設計師每月排休`;
  $('address').textContent = cfg.shop.address;
  $('mapLink').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.shop.mapQuery)}`;
  $('phone').textContent = cfg.shop.phone;
  $('telLink').href = `tel:${cfg.shop.phone.replace(/\s/g, '')}`;
  $('shifts').innerHTML = cfg.designers.map((d) =>
    `<span class="s-name">${esc(d.name)}</span><span class="s-shift">${esc(d.role === '店長' ? '店長・' : '')}${esc(d.shift)}</span><span class="num">${d.start}–${d.end}</span>`
  ).join('');
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
        ${queued ? `<div class="dcard-queue">指定等候 ${queued} 人</div>` : ''}
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
      const who = info.designer ? `指定 ${esc(name(info.designer))}・` : '';
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

  // ===== 什麼時候來最不用等 =====
  const DOWS = [1, 2, 3, 4, 5, 6, 0];                 // 一～日
  const DOW_NAME = ['日', '一', '二', '三', '四', '五', '六'];
  const MIN_DAYS = 14;                                 // 至少累積兩週才顯示，避免誤導
  const openHour = Math.floor(QC.toMin(cfg.shop.open) / 60);
  const closeHour = Math.ceil(QC.toMin(cfg.shop.close) / 60);
  let crowd = null;
  let pickedDow = null;

  const todayDow = () => {
    const [y, m, d] = taipeiNow().date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  const level = (v, max) => (v < max * 0.45 ? 'low' : v < max * 0.75 ? 'mid' : 'high');
  const LEVEL_TEXT = { low: '通常人少', mid: '人潮普通', high: '通常人多' };

  function renderCrowd() {
    if (pickedDow === null) pickedDow = todayDow();
    $('dowTabs').innerHTML = DOWS.map((d) =>
      `<button class="${d === pickedDow ? 'on' : ''}" data-dow="${d}" role="tab" aria-selected="${d === pickedDow}">${DOW_NAME[d]}</button>`
    ).join('');

    if (!crowd) { $('crowdBody').innerHTML = '<p class="crowd-empty">載入中…</p>'; return; }
    if (crowd.days < MIN_DAYS) {
      $('crowdBody').innerHTML = `<p class="crowd-empty">人潮資料累積中（已記錄 ${crowd.days} 天）<br>滿兩週後就會顯示各時段的人潮</p>`;
      return;
    }

    const avg = {};
    for (const h of crowd.hours) avg[`${h.dow}-${h.hour}`] = Number(h.avg);
    const max = Math.max(1, ...crowd.hours.filter((h) => h.hour >= openHour && h.hour < closeHour).map((h) => Number(h.avg)));
    const hours = [];
    for (let h = openHour; h < closeHour; h++) hours.push(h);
    const values = hours.map((h) => avg[`${pickedDow}-${h}`] || 0);
    const now = taipeiNow();
    const nowHour = Math.floor(now.minutes / 60);
    const isToday = pickedDow === todayDow();

    const bars = hours.map((h, i) => {
      const v = values[i];
      const lv = level(v, max);
      const cur = isToday && h === nowHour && shopStatus(cfg, now).open;
      return `<div class="bar ${lv} ${cur ? 'now' : ''}" style="height:${Math.max(4, (v / max) * 100)}%"
        title="${h}:00 ${LEVEL_TEXT[lv]}" aria-label="${h} 點：${LEVEL_TEXT[lv]}"></div>`;
    }).join('');
    const axis = hours.map((h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('');

    // 找出這一天最不用等的連續兩小時（只看完整營業的整點）
    let best = null;
    for (let i = 0; i + 1 < hours.length; i++) {
      if (hours[i] * 60 < QC.toMin(cfg.shop.open) || (hours[i] + 2) * 60 > QC.toMin(cfg.shop.close)) continue;
      const sum = values[i] + values[i + 1];
      if (!best || sum < best.sum) best = { sum, h: hours[i] };
    }
    const pad = (h) => `${String(h).padStart(2, '0')}:00`;
    let tip = best ? `週${DOW_NAME[pickedDow]} ${pad(best.h)}–${pad(best.h + 2)} 通常最不用等` : '';
    if (isToday && shopStatus(cfg, now).open) {
      const cur = values[hours.indexOf(nowHour)];
      if (cur !== undefined) tip = `這個時段${LEVEL_TEXT[level(cur, max)]}・${tip}`;
    }

    $('crowdBody').innerHTML = `
      <div class="bars">${bars}</div>
      <div class="bars-axis">${axis}</div>
      <div class="legend"><span><i style="background:#c3e5e0"></i>人少</span><span><i style="background:#7cc5bc"></i>普通</span><span><i style="background:#f0b77c"></i>人多</span></div>
      ${tip ? `<p class="crowd-tip">${esc(tip)}</p>` : ''}
      <p class="crowd-note">依過去 ${Math.min(crowd.days, 56)} 天的叫號紀錄統計${crowd.demo ? '（示範資料）' : ''}</p>`;
  }

  $('dowTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dow]');
    if (!b) return;
    pickedDow = Number(b.dataset.dow);
    renderCrowd();
  });

  function loadCrowd() {
    store.crowdStats().then((c) => { crowd = c; renderCrowd(); })
      .catch(() => { $('crowdBody').innerHTML = '<p class="crowd-empty">暫時無法載入人潮資料</p>'; });
  }
  renderCrowd();
  loadCrowd();
  setInterval(loadCrowd, 30 * 60000);     // 歷史統計半小時更新一次就夠
  setInterval(renderCrowd, 5 * 60000);    // 「現在」標記跟著時間移動

  function setLive(s) {
    $('live').classList.toggle('err', s === 'error');
    $('liveLabel').textContent = s === 'error' ? '重新連線中…' : '即時更新';
  }

  store.load().then((s) => { state = s; render(); }).catch(() => setLive('error'));
  store.subscribe((s) => { state = s; setLive('live'); render(); }, setLive);
  // 上下班、營業時間會隨時間改變
  setInterval(render, 30000);
})();
