/*
 * 請進 快剪 — 線上看號 設定檔
 * 店家資料、設計師、班表都在這裡改。
 */
window.QC_CONFIG = {
  // ===== Supabase 連線設定 =====
  // 兩個都留空 = 「示範模式」：資料只存在這台電腦的瀏覽器，方便先試玩。
  // 申請 Supabase 後填入（README.md 有教學）。
  supabaseUrl: '',      // 例：'https://abcdefgh.supabase.co'
  supabaseKey: '',      // anon / publishable key（可以公開的那一把）

  shopId: 'qingjin',    // 要跟 supabase/setup.sql 裡的店家代號一樣

  // 設計師超過幾分鐘沒叫號，就當作「空檔中」，客人頁會顯示「現在人少」
  idleMinutes: 20,

  // ===== 店家資料 =====
  shop: {
    name: '請進',
    nameEn: 'PLEASE COME IN',
    slogan: '$120 佰二剪髮',
    price: 120,
    phone: '0982 283 384',
    address: '234 新北市永和區永平路 180 巷 1 號 1F',
    mapQuery: '請進 快剪 新北市永和區永平路180巷1號',
    open: '09:30',
    close: '22:30',
  },

  // ===== 設計師（id 要跟 supabase/setup.sql 一樣）=====
  designers: [
    { id: 'jiang', name: '江江', role: '店長', shift: '全班', start: '09:30', end: '22:30' },
    { id: 'chien', name: '琪恩', role: '設計師', shift: '早班', start: '09:30', end: '21:30' },
    { id: 'tim',   name: 'Tim',  role: '設計師', shift: '中班', start: '11:00', end: '22:30' },
    { id: 'katie', name: '凱蒂', role: '設計師', shift: '晚班', start: '12:00', end: '22:30' },
  ],
};
