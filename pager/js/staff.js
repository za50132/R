/* 叫號頁（老闆、設計師用） */
(function () {
  const { cfg, store, pad3, waitText, agoText, waitInfo, esc } = window.PG;
  const $ = (id) => document.getElementById(id);
  const PIN_KEY = `pg-staff-${cfg.shopId}`;

  let state = null;
  let pin = null;
  let busy = false;
  try { pin = localStorage.getItem(PIN_KEY); } catch (e) { /* 無痕視窗 */ }
  if (store.mode === 'demo') $('demoBanner').hidden = false;

  // ---------- 小工具 ----------
  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(40); } catch (e) { /* iOS 不支援 */ } };
  function ask(text, yes = '確定') {
    return new Promise((resolve) => {
      const dlg = $('askDialog');
      $('askText').textContent = text;
      $('askYes').textContent = yes;
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
      dlg.showModal();
    });
  }
  function show(view) {
    $('loginView').hidden = view !== 'login';
    $('mainView').hidden = view !== 'main';
    window.scrollTo(0, 0);
  }

  // ---------- 登入 ----------
  $('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('pinInput').value.trim();
    if (!p) return;
    const r = await store.act(p, 'ping');
    if (!r.ok) { $('pinErr').textContent = r.message; return; }
    pin = p;
    try { localStorage.setItem(PIN_KEY, p); } catch (err) { /* 無痕視窗 */ }
    $('pinErr').textContent = '';
    enterMain();
  });
  $('btnLogout').addEventListener('click', async () => {
    if (!await ask('確定要登出這支手機嗎？', '登出')) return;
    pin = null;
    try { localStorage.removeItem(PIN_KEY); } catch (e) { /* 無痕視窗 */ }
    $('pinInput').value = '';
    show('login');
  });

  // ---------- 叫號 ----------
  async function act(action, number = null) {
    if (busy) return null;
    busy = true;
    $('btnNext').disabled = true;
    buzz();
    try {
      const r = await store.act(pin, action, number);
      toast(r.message, !r.ok);
      if (!r.ok && r.message === '密碼錯誤') { pin = null; try { localStorage.removeItem(PIN_KEY); } catch (e) { /* */ } show('login'); }
      return r;
    } finally {
      busy = false;
      $('btnNext').disabled = false;
    }
  }

  $('btnNext').addEventListener('click', () => act('next'));
  $('btnUndo').addEventListener('click', async () => {
    if (!state || state.prev == null) { toast('沒有可以退回的號碼', true); return; }
    if (await ask(`退回到 ${pad3(state.prev)} 號？`, '退回')) act('undo');
  });

  // 大數字鍵盤
  let typed = '';
  const showTyped = () => { $('padDisplay').textContent = typed ? typed.padStart(3, '0') : '---'; };
  $('btnCall').addEventListener('click', () => { typed = ''; showTyped(); $('callDialog').showModal(); });
  $('callCancel').addEventListener('click', () => $('callDialog').close());
  $('pad').addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]');
    if (!k) return;
    const key = k.dataset.k;
    if (key === 'del') typed = typed.slice(0, -1);
    else if (key === 'ok') {
      const n = parseInt(typed, 10);
      if (!n) return;
      $('callDialog').close();
      act('call', n);
      return;
    } else if (typed.length < 3) typed = (typed + key).replace(/^0+/, '');
    showTyped();
  });

  // 預估等待時間
  $('waitGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wait]');
    if (b) act('set_wait', Number(b.dataset.wait));
  });

  function render() {
    if (!state) return;
    $('curNum').textContent = pad3(state.current);
    $('nextHint').textContent = state.current >= 999 ? '號碼已到 999' : `叫 ${pad3(state.current + 1)} 號`;
    const w = waitInfo(state);
    const el = $('waitNow');
    el.classList.toggle('stale', !w || !w.fresh);
    el.innerHTML = !w ? '還沒設定：客人頁不會顯示等待時間'
      : w.fresh ? `客人看到：<b>${esc(waitText(w.minutes))}</b>・${esc(agoText(w.ago))}`
      : `${esc(agoText(w.ago))}，客人頁已隱藏，請重新設定`;
    $('waitGrid').innerHTML = (cfg.waitOptions || [0, 10, 20, 30, 45, 60]).map((n) =>
      `<button class="btn ${w && w.fresh && w.minutes === n ? 'on' : ''}" data-wait="${n}">${n === 0 ? '免等' : n >= 60 ? '60+' : n}</button>`
    ).join('');
  }

  // ---------- 設定：QR Code、Apple Watch、密碼 ----------
  const customerUrl = new URL('./', location.href).href;
  $('customerUrl').textContent = customerUrl;
  $('btnCopyUrl').addEventListener('click', () => {
    if (!navigator.clipboard) { toast('請長按網址手動複製', true); return; }
    navigator.clipboard.writeText(customerUrl).then(() => toast('已複製網址'), () => toast('請長按網址手動複製', true));
  });
  let qrTries = 0;
  function renderQr() {
    if (!window.qrcode) {
      $('qr').textContent = qrTries < 20 ? 'QR Code 載入中…' : 'QR Code 載入失敗，請檢查網路後重新整理';
      if (qrTries++ < 20) setTimeout(renderQr, 500);
      return;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(customerUrl);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  function renderWatch() {
    if (store.mode !== 'supabase') {
      $('watchInfo').innerHTML = '<p class="hint">設定好 Supabase 之後，這裡會顯示捷徑要貼的網址和內容。</p>';
      return;
    }
    const body = (extra) => JSON.stringify({ p_shop: cfg.shopId, p_pin: '（密碼）', ...extra });
    $('watchInfo').innerHTML = `
      <div class="kv">網址（URL）</div><div class="code">${esc(cfg.supabaseUrl.replace(/\/$/, ''))}/rest/v1/rpc/pager_action</div>
      <div class="kv">方法</div><div class="code">POST</div>
      <div class="kv">標頭（Headers）</div><div class="code">apikey: ${esc(cfg.supabaseKey)}\nContent-Type: application/json</div>
      <div class="kv">下一位</div><div class="code">${esc(body({ p_action: 'next' }))}</div>
      <div class="kv">輸入號碼叫號（p_number 用「要求輸入」的數字）</div><div class="code">${esc(body({ p_action: 'call', p_number: 25 }))}</div>
      <div class="kv">預估等待時間（p_number 用「從選單中選擇」的分鐘數）</div><div class="code">${esc(body({ p_action: 'set_wait', p_number: 20 }))}</div>
      <div class="kv">退回</div><div class="code">${esc(body({ p_action: 'undo' }))}</div>`;
  }
  $('pinChangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const np = $('newPin').value.trim();
    const r = await store.act(pin, 'set_pin', null, np);
    toast(r.message, !r.ok);
    if (r.ok) {
      pin = np;
      try { localStorage.setItem(PIN_KEY, np); } catch (err) { /* 無痕視窗 */ }
      $('newPin').value = '';
    }
  });

  function enterMain() {
    show('main');
    render();
    renderQr();
    renderWatch();
  }

  // ---------- 資料同步 ----------
  store.load().then((s) => { state = s; render(); }).catch(() => toast('連線失敗，請檢查網路', true));
  store.subscribe((s) => { state = s; render(); }, (s) => { if (s === 'error') toast('連線中斷，重新連線中…', true); });
  setInterval(render, 30000);

  if (pin) enterMain(); else show('login');
})();
