/*
 * 請進 快剪 — 線上叫號（簡單版）設定檔
 */
window.PG_CONFIG = {
  // ===== Supabase 連線設定 =====
  // 兩個都留空 = 「示範模式」：資料只存在這台電腦的瀏覽器，方便先試玩。
  supabaseUrl: '',      // 例：'https://abcdefgh.supabase.co'
  supabaseKey: '',      // anon / publishable key（可以公開的那一把）
  shopId: 'qingjin',    // 要跟 supabase/setup.sql 裡的店家代號一樣

  // 客人的號碼還差幾號時，先提醒「快輪到您了」
  nearAlert: 2,

  // 老闆輸入的預估等待時間，超過幾分鐘沒更新就不再顯示給客人
  waitFreshMinutes: 60,
  // 等待時間快速按鈕（分鐘；0 = 免等，60 = 60 分鐘以上）
  waitOptions: [0, 10, 20, 30, 45, 60],

  // ===== 店家資料 =====
  shop: {
    name: '請進',
    nameEn: 'PLEASE COME IN',
    phone: '0982 283 384',
    address: '234 新北市永和區永平路 180 巷 1 號 1F',
    mapQuery: '請進 快剪 新北市永和區永平路180巷1號',
    open: '09:30',
    close: '22:30',
  },
};
