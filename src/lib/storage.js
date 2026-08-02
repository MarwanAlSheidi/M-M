// خارج بيئة Artifacts لا يوجد window.storage — هذا الغلاف يحاكي نفس الواجهة
// (get يرمي عند غياب المفتاح، set يعيد {key,value}) فوق localStorage.
export const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    if (value === null) throw new Error("missing");
    return { key, value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};
