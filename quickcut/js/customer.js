/* 客人頁 */
(function () {
  const cfg = window.QC_CONFIG;
  const { store, pad3, esc, taipeiNow, shopStatus, designerView, addDays, shortDate } = window.QC;
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
    $('heroSub').textContent = n ? '請對照您的號碼牌' : (open.open ? '今天還沒開始叫號' : '休息中，明天見');
    if (lastHero !== null && n !== lastHero) bump(hero);
    lastHero = n;

    // 設計師
    $('designers').innerHTML = cfg.designers.map((d) => {
      const v = designerView(d, state, now);
      const body = v.number
        ? `<div class="dcard-num num" data-id="${d.id}">${pad3(v.number)}</div>`
        : `<div class="dcard-big-label">${v.kind === 'off' ? '休假' : v.kind === 'away' ? '不在店' : '—'}</div>`;
      return `<article class="dcard ${v.kind}">
        <div class="dcard-head"><span class="dcard-name">${esc(d.name)}</span><span class="dcard-role">${esc(d.role === '店長' ? '店長' : d.shift)}</span></div>
        <div class="dcard-state"><span class="dot"></span>${esc(v.label)}</div>
        ${body}
      </article>`;
    }).join('');
    for (const d of cfg.designers) {
      const num = (designerView(d, state, now).number) || null;
      const el = document.querySelector(`.dcard-num[data-id="${d.id}"]`);
      if (el && d.id in lastCard && lastCard[d.id] !== num) bump(el);
      lastCard[d.id] = num;
    }

    // 近期休假（14 天內）
    const rows = [];
    for (let i = 0; i < 14; i++) {
      const day = addDays(now.date, i);
      const names = cfg.designers.filter((d) => state.daysOff.some((o) => o.designer === d.id && o.day === day)).map((d) => d.name);
      if (names.length) rows.push(`<li><span class="date">${i === 0 ? '今天' : i === 1 ? '明天' : shortDate(day)}</span><span class="names">${names.map(esc).join('、')} 休假</span></li>`);
    }
    $('offList').innerHTML = rows.length ? rows.join('') : '<li class="empty">未來兩週設計師都有上班</li>';
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
