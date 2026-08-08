/**
 * بديل مصغَّر لـ Parse — يكفي لتحميل دوال السحابة وتشغيلها على مخزن في الذاكرة.
 *
 * الغرض تغطية المنطق المالي بلا خادم حقيقي. ما يُحاكى هنا هو ما تستعمله الدوال
 * فعلاً لا أكثر؛ أي استعمال جديد في `cloud/` يلزمه توسيع هذا الملف.
 *
 * قيد مقصود: `save` لا تُشغّل المُشغّلات تلقائياً. المُشغّلات تُختبر باستدعائها
 * مباشرة عبر `api.trigger(...)`، وإلا لزم محاكاة دورة حياة Parse كاملة.
 */

const path = require('path');

const CLOUD = path.join(__dirname, '..', '..', 'cloud');

/** مسارا نقطة الدخول: المجزّأة والمدمجة. الاختبارات نفسها تُشغَّل على الاثنين. */
const ENTRIES = {
  modular: path.join(CLOUD, 'main.js'),
  bundle: path.join(CLOUD, 'main.bundle.js'),
};

class ParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
Object.assign(ParseError, {
  INVALID_SESSION_TOKEN: 209,
  VALIDATION_ERROR: 142,
  OBJECT_NOT_FOUND: 101,
  OPERATION_FORBIDDEN: 119,
  DUPLICATE_VALUE: 137,
  OTHER_CAUSE: -1,
});

function createMock() {
  const functions = {}; // اسم الدالة → معالجها
  const jobs = {}; // اسم المهمة الدورية → معالجها
  const triggers = {}; // "beforeSave:Mosques" → معالجه
  const store = {}; // اسم الفئة → كائنات
  const pushes = []; // { users, payload } لكل إشعار أُرسل
  const gateway = { status: 'unpaid', amountBaisa: 0, sessions: 0 };
  let seq = 0;

  /** أسماء الفئات المدمجة تصل كدوال لا كنصوص. */
  const classNameOf = (target) => {
    if (typeof target === 'string') return target;
    return target && target.name === 'Installation' ? '_Installation' : '_User';
  };

  const nextId = (className) => `${className}_${++seq}`;

  class MockObject {
    constructor(className) {
      this.className = className;
      this.attributes = {};
      this._dirty = new Set();
      this._new = true;
      this._acl = null;
    }

    set(key, value) {
      this.attributes[key] = value;
      this._dirty.add(key);
      return this;
    }

    unset(key) {
      delete this.attributes[key];
      this._dirty.add(key);
      return this;
    }

    get(key) {
      return this.attributes[key];
    }

    increment(key, by = 1) {
      this.attributes[key] = (this.attributes[key] || 0) + by;
      this._dirty.add(key);
      return this;
    }

    isNew() {
      return this._new;
    }

    dirty(key) {
      return key === undefined ? this._dirty.size > 0 : this._dirty.has(key);
    }

    getACL() {
      return this._acl;
    }

    setACL(acl) {
      this._acl = acl;
      return this;
    }

    toJSON() {
      return { objectId: this.id, ...this.attributes };
    }

    async fetch() {
      return this;
    }

    async save() {
      if (this._new) {
        this.id = nextId(this.className);
        this.attributes.createdAt = this.attributes.createdAt || new Date();
        (store[this.className] = store[this.className] || []).push(this);
        this._new = false;
      }
      this._dirty.clear();
      return this;
    }
  }

  const matches = (object, key, expected) => {
    const actual = object.get(key);
    if (key === 'objectId') return object.id === expected;
    if (expected && expected.id) return actual && actual.id === expected.id;
    // `equalTo` على حقل مصفوفة يعمل على MongoDB وحده؛ محوّل PostgreSQL يرمي
    // «invalid input syntax for type json». نرفضها هنا حتى لا يمرّ نمطٌ غير
    // محمول في الاختبار ثم يسقط على خادم حقيقي. البديل: `containsAll`.
    if (Array.isArray(actual)) {
      throw new Error(`equalTo على حقل مصفوفة غير محمول (${key}) — استخدم containsAll`);
    }
    return actual === expected;
  };

  class MockQuery {
    constructor(target) {
      this.className = classNameOf(target);
      this._equal = [];
      this._greater = [];
      this._less = [];
      this._atLeast = [];
      this._atMost = [];
      this._contained = [];
      this._containsAll = [];
      this._prefix = [];
      this._substring = [];
    }

    equalTo(key, value) { this._equal.push([key, value]); return this; }
    greaterThan(key, value) { this._greater.push([key, value]); return this; }
    lessThan(key, value) { this._less.push([key, value]); return this; }
    greaterThanOrEqualTo(key, value) { this._atLeast.push([key, value]); return this; }
    lessThanOrEqualTo(key, value) { this._atMost.push([key, value]); return this; }
    containedIn(key, values) { this._contained.push([key, values]); return this; }
    containsAll(key, values) { this._containsAll.push([key, values]); return this; }
    startsWith(key, prefix) { this._prefix.push([key, prefix]); return this; }
    contains(key, needle) { this._substring.push([key, needle]); return this; }
    limit() { return this; }
    select() { return this; }
    include() { return this; }
    descending() { return this; }
    ascending() { return this; }
    withinKilometers() { return this; }

    _rows() {
      return (store[this.className] || []).filter((object) =>
        this._equal.every(([k, v]) => matches(object, k, v)) &&
        this._greater.every(([k, v]) => object.get(k) > v) &&
        this._less.every(([k, v]) => object.get(k) < v) &&
        this._atLeast.every(([k, v]) => object.get(k) >= v) &&
        this._atMost.every(([k, v]) => object.get(k) <= v) &&
        this._contained.every(([k, values]) => values.includes(object.get(k))) &&
        this._containsAll.every(([k, values]) => {
          const actual = object.get(k);
          return Array.isArray(actual) && values.every((v) => actual.includes(v));
        }) &&
        this._prefix.every(([k, v]) => String(object.get(k) || '').startsWith(v)) &&
        this._substring.every(([k, v]) => String(object.get(k) || '').includes(v)));
    }

    async find() { return this._rows(); }
    async first() { return this._rows()[0]; }
    async count() { return this._rows().length; }

    async get(objectId) {
      const hit = (store[this.className] || []).find((o) => o.id === objectId);
      if (!hit) throw new ParseError(ParseError.OBJECT_NOT_FOUND, 'Object not found.');
      return hit;
    }
  }

  class MockACL {
    constructor() { this._read = new Set(); this._write = new Set(); this._public = { read: false, write: false }; }
    setReadAccess(id, allowed) { allowed ? this._read.add(id) : this._read.delete(id); }
    setWriteAccess(id, allowed) { allowed ? this._write.add(id) : this._write.delete(id); }
    getReadAccess(id) { return this._read.has(id); }
    getWriteAccess(id) { return this._write.has(id); }
    setPublicReadAccess(allowed) { this._public.read = allowed; }
    setPublicWriteAccess(allowed) { this._public.write = allowed; }
    getPublicReadAccess() { return this._public.read; }
    getPublicWriteAccess() { return this._public.write; }
  }

  const triggerKey = (target, type) => `${type}:${classNameOf(target)}`;

  global.Parse = {
    Error: ParseError,
    Cloud: {
      define: (name, handler) => { functions[name] = handler; },
      job: (name, handler) => { jobs[name] = handler; },
      beforeSave: (target, handler) => { triggers[triggerKey(target, 'beforeSave')] = handler; },
      afterSave: (target, handler) => { triggers[triggerKey(target, 'afterSave')] = handler; },
      httpRequest: async ({ method }) => (method === 'POST'
        ? { data: { data: { session_id: `sess_${++gateway.sessions}` } } }
        : {
          data: {
            data: {
              payment_status: gateway.status,
              total_amount: gateway.amountBaisa,
              invoice: 'inv_test',
            },
          },
        }),
    },
    Query: MockQuery,
    Object: Object.assign(function ParseObject() {}, {
      extend: (className) => class extends MockObject {
        constructor() { super(className); }
      },
      saveAll: async (objects) => {
        for (const object of objects) await object.save();
        return objects;
      },
      destroyAll: async (objects) => {
        for (const object of objects) {
          const rows = store[object.className] || [];
          const at = rows.indexOf(object);
          if (at !== -1) rows.splice(at, 1);
        }
      },
    }),
    ACL: MockACL,
    User: function User() {},
    Installation: function Installation() {},
    GeoPoint: class GeoPoint {},
    // يُلتقط منه المستخدمون المستهدفون: push.js يستعلم على _Installation
    // بشرط containedIn('user', users)، وهو ما يهمّ التحقق منه.
    Push: {
      send: async ({ where, data }) => {
        const users = (where && where._contained
          .filter(([key]) => key === 'user')
          .flatMap(([, values]) => values)) || [];
        pushes.push({ users, payload: data });
      },
    },
  };

  return {
    functions,
    jobs,
    triggers,
    store,
    pushes,
    gateway,
    ParseError,

    /** كائن مخزَّن جاهز — يتخطّى `save` ليمكن ضبط `createdAt` في الماضي. */
    make(className, attributes = {}, createdAt = new Date()) {
      const object = new MockObject(className);
      Object.assign(object.attributes, attributes, { createdAt });
      object.id = nextId(className);
      object._new = false;
      object._dirty.clear();
      (store[className] = store[className] || []).push(object);
      return object;
    },

    /** مستخدم كما تراه دوال السحابة: الدور يُقرأ عبر `get` لا من الحقول. */
    asUser(id, role = 'donor') {
      return { id, get: (key) => (key === 'role' ? role : undefined) };
    },

    /** استدعاء دالة سحابة؛ يعيد `{ ok }` أو `{ error }` بدل الرمي. */
    async call(name, params = {}, { user = null, master = false } = {}) {
      if (!this.functions[name]) throw new Error(`دالة غير مسجّلة: ${name}`);
      try {
        return { ok: await this.functions[name]({ params, user, master }) };
      } catch (error) {
        return { error };
      }
    },

    /** تشغيل مهمة دورية؛ يُلتقط ما تبثّه عبر `message`. */
    async runJob(name, params = {}) {
      if (!this.jobs[name]) throw new Error(`مهمة غير مسجّلة: ${name}`);
      const messages = [];
      const result = await this.jobs[name]({ params, message: (m) => messages.push(m) });
      return { result, messages };
    },

    /** استدعاء مُشغّل مباشرةً — `save` في هذا البديل لا تُشغّلها تلقائياً. */
    async trigger(key, request) {
      if (!this.triggers[key]) throw new Error(`مُشغّل غير مسجّل: ${key}`);
      return this.triggers[key](request);
    },
  };
}

/**
 * يثبّت البديل ثم يحمّل كود السحابة من الصفر.
 * التحميل بعد التثبيت لازم: الوحدات تقرأ `Parse` وتسجّل معالجاتها عند التحميل.
 */
function loadCloud(entry = 'modular', { payments = true } = {}) {
  // `payments: false` يُحاكي المرحلة الأولى: منصّة بلا مفاتيح بوابة أصلاً
  if (payments) {
    process.env.THAWANI_SECRET_KEY = 'sk_test';
    process.env.THAWANI_PUBLISHABLE_KEY = 'pk_test';
  } else {
    delete process.env.THAWANI_SECRET_KEY;
    delete process.env.THAWANI_PUBLISHABLE_KEY;
  }

  const file = ENTRIES[entry];
  if (!file) throw new Error(`نقطة دخول غير معروفة: ${entry}`);

  const api = createMock();
  for (const loaded of Object.keys(require.cache)) {
    if (loaded.startsWith(CLOUD)) delete require.cache[loaded];
  }
  require(file);
  return api;
}

module.exports = { loadCloud, ENTRIES, CLOUD };
