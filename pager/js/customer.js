/* 客人頁：看目前號碼、輸入自己的號碼，輪到時提醒 */
(function () {
  const { cfg, store, pad3, waitText, agoText, shopStatus, waitInfo, taipeiNow } = window.PG;
  const $ = (id) => document.getElementById(id);
  const MINE_KEY = `pg-mine-${cfg.shopId}`;

  let state = null;
  let lastHero = null;
  let mine = null;            // { day, number }
  let alerted = { near: false, turn: false };
  let audio = null;
  let wakeLock = null;

  // 固定資訊
  $('hours').textContent = `每日 ${cfg.shop.open}–${cfg.shop.close}`;
  $('address').textContent = cfg.shop.address;
  $('mapLink').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.shop.mapQuery)}`;
  $('phone').textContent = cfg.shop.phone;
  $('telLink').href = `tel:${cfg.shop.phone.replace(/\s/g, '')}`;
  if (store.mode === 'demo') $('demoBanner').hidden = false;

  try {
    const saved = JSON.parse(localStorage.getItem(MINE_KEY));
    if (saved && saved.day === taipeiNow().date) mine = saved;
  } catch (e) { /* 無痕視窗 */ }

  // ---------- 提醒：聲音、震動、螢幕不熄 ----------
  // 瀏覽器規定要使用者先點一下才能出聲，所以在按「提醒我」時先準備好
  function prepareAlerts() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
    keepAwake();
  }
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* 不支援或被拒絕：就只能請客人別鎖螢幕 */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mine) keepAwake(); });
  // 重新整理後要再點一下畫面，瀏覽器才允許出聲
  document.addEventListener('pointerdown', () => { if (mine) prepareAlerts(); });

  function beep(times) {
    if (!audio) return;
    for (let i = 0; i < times; i++) {
      const t = audio.currentTime + i * 0.35;
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.3);
    }
  }
  function alertMe(kind) {
    beep(kind === 'turn' ? 4 : 2);
    try { navigator.vibrate && navigator.vibrate(kind === 'turn' ? [300, 150, 300, 150, 300] : [200, 100, 200]); } catch (e) { /* iOS 不支援 */ }
  }

  // ---------- 我的號碼 ----------
  $('mineForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = parseInt($('mineInput').value, 10);
    if (!(n >= 1 && n <= 999)) return;
    mine = { day: taipeiNow().date, number: n };
    alerted = { near: false, turn: false };
    try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch (err) { /* 無痕視窗 */ }
    prepareAlerts();
    $('mineInput').blur();
    render(true);
  });
  $('mineClear').addEventListener('click', () => {
    mine = null;
    try { localStorage.removeItem(MINE_KEY); } catch (e) { /* 無痕視窗 */ }
    if (wakeLock) wakeLock.release();
    render();
    setTimeout(() => $('mineInput').focus(), 50);
  });

  function renderMine(firstTime) {
    $('mineForm').hidden = Boolean(mine);
    $('mineCard').hidden = !mine;
    if (!mine) return;
    const cur = state.current;
    const diff = mine.number - cur;
    const near = cfg.nearAlert || 2;
    let msg, cls;
    if (!cur) { msg = '今天還沒開始叫號'; cls = ''; }
    else if (diff === 0) { msg = '輪到您了！請進'; cls = 'turn'; }
    else if (diff < 0) { msg = '已經叫過您的號碼了，請直接跟店內人員說一聲'; cls = 'past'; }
    else if (diff <= near) { msg = `快輪到您了！還差 ${diff} 號，請回到店裡`; cls = 'near'; }
    else { msg = `還差 ${diff} 號`; cls = ''; }
    $('mineNum').textContent = pad3(mine.number);
    $('mineMsg').textContent = msg;
    $('mineCard').className = `mine-card ${cls}`;
    $('mineTip').hidden = cls === 'turn' || cls === 'past';

    // 只在「變成」快輪到／輪到的那一刻提醒一次；剛輸入號碼時不吵
    if (!firstTime) {
      if (cls === 'turn' && !alerted.turn) alertMe('turn');
      else if (cls === 'near' && !alerted.near) alertMe('near');
    }
    if (cls === 'turn') alerted.turn = true;
    if (cls === 'near' || cls === 'turn') alerted.near = true;
  }

  // ---------- 畫面 ----------
  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  function render(firstTime = false) {
    if (!state) return;
    const now = taipeiNow();
    const open = shopStatus(now);
    $('openLabel').textContent = open.label;
    $('openDot').classList.toggle('closed', !open.open);

    const hero = $('heroNum');
    hero.textContent = pad3(state.current);
    hero.classList.toggle('idle', !state.current);
    $('heroSub').textContent = state.current ? '請對照您的號碼牌' : open.open ? '今天還沒開始叫號' : '休息中，明天見';
    if (lastHero !== null && state.current !== lastHero) bump(hero);
    lastHero = state.current;

    const w = open.open ? waitInfo(state) : null;
    $('wait').hidden = !(w && w.fresh);
    if (w && w.fresh) {
      $('waitValue').textContent = waitText(w.minutes);
      $('waitAgo').textContent = agoText(w.ago);
      $('wait').classList.toggle('short', w.minutes <= 10);
      $('wait').classList.toggle('long', w.minutes >= 30);
    }
    renderMine(firstTime);
  }

  function setLive(s) {
    $('live').classList.toggle('err', s === 'error');
    $('liveLabel').textContent = s === 'error' ? '重新連線中…' : '即時更新';
  }

  store.load().then((s) => { state = s; render(true); }).catch(() => setLive('error'));
  store.subscribe((s) => { state = s; setLive('live'); render(); }, setLive);
  setInterval(() => render(), 30000);   // 營業時間、「幾分鐘前更新」隨時間改變
})();
