# مسجدي (Masjidi) — الملف الهندسي الكامل

**الإصدار:** 1.0.0
**آخر تحديث:** أغسطس 2026

منصة تربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة والمتبرعين،
لإدارة أعمال الصيانة بشفافية. Backend على Parse Server (Back4app)، مهيّأ مسبقاً
بـ **18,214 مسجداً** من البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية.

> **هذا الملف يحتوي المشروع كاملاً** — السياق، المراجعة، المخطط، كل كود السحابة
> (مجزّأً ومدمجاً)، وكل السكربتات بما فيها مولّدا هذا الملف نفسه، فيمكن للملف أن
> يُعيد إنتاج نفسه. المستثنى ملفّا البيانات المولّدان وحدهما:
> `data/mosques.json` (11 ميغابايت، 18 ألف سجل) و`data/mosques.sample.json` —
> كلاهما يُولَّد من سكربت التنظيف في القسم 9.

## كيف تستخدمه

**مع Claude Code:** ضع هذا الملف في مجلد فارغ باسم `CLAUDE.md`، شغّل `claude`،
واطلب منه تفكيكه إلى البنية الموصوفة في القسم 3. استخدم **القسم 6أ** — وهو
الملفات كما هي على القرص بكامل `require` و`module.exports`. لا تُفكّك القسم 6ب.

**يدوياً:** انسخ كود **القسم 6ب** (الملف المدمج) إلى `main.js` في لوحة Back4app
والصقه مباشرة.

---

## الفهرس

| # | القسم |
|---|---|
| 1 | [الحالة والقيود](#1-الحالة-والقيود) |
| 2 | [قواعد العمل](#2-قواعد-العمل) |
| 3 | [البنية](#3-البنية) |
| 4 | [مراجعة الكود الأصلي — ثغرات حرجة](#4-مراجعة-الكود-الأصلي) |
| 5 | [مخطط قاعدة البيانات](#5-مخطط-قاعدة-البيانات) |
| 6 | [كود السحابة كاملاً — مجزّأً (6أ) ومدمجاً (6ب)](#6-كود-السحابة-كاملاً) |
| 7 | [دورة حياة الطلب والدوال وقواعد الأمن](#7-دورة-حياة-الطلب-والدوال-وقواعد-الأمن) |
| 8 | [البيانات](#8-البيانات) |
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) — و[الاختبارات](#9ب-الاختبارات) |
| 10 | [خطة التشغيل](#10-خطة-التشغيل) |

---

## 1. الحالة والقيود

منصة تربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة والمتبرعين،
لإدارة أعمال صيانة المساجد بشفافية. Backend على Parse Server (Back4app)،
والتطبيق العميل React Native (لم يُبدأ بعد).

قاعدة البيانات الأولية: **18,214 مسجداً** من البيانات المفتوحة لوزارة الأوقاف
والشؤون الدينية (2025–2026)، منظّفة وجاهزة في `data/mosques.json`.

### الحالة الحالية

| الجزء | الحالة |
|---|---|
| تنظيف بيانات المساجد | ✅ منجز — `scripts/clean_mosques.py` |
| مخطط قاعدة البيانات | ✅ معرّف — `cloud/schema.json` |
| دوال السحابة | ✅ مكتوبة، ❌ غير مُختبرة على خادم حقيقي |
| سكربت الاستيراد | ✅ مكتوب، ❌ لم يُشغّل |
| بوابة الدفع | ⚠️ محوّل مكتوب بلا مفاتيح — **لا تُفعّل** (انظر القيود) |
| تطبيق العميل | ⚠️ واجهة ويب عربية في `app/` تغطي مسار التطوّع — لا React Native ولا خريطة ولا PWA |
| الاختبارات | ✅ 109 حالة على بديل Parse (`npm test`) + اختبار تكامل على `parse-server` حقيقي فوق PostgreSQL (`npm run test:integration`) |

---

## 2. قواعد العمل

1. **كل كتابة تمر عبر Cloud Code.** فئات `ServiceRequests` و`Transactions`
   و`Mosques` مقفلة للكتابة من العميل عبر CLP و`beforeSave`. لا تفتحها.
2. **`useMasterKey` داخل دوال السحابة فقط.** لا يظهر Master Key في أي كود عميل.
3. **الأدوار تُقرأ من الكائن المخزّن**، لا من `request.params`. استخدم
   `requireRole()` من `lib/auth.js`.
4. **المال لا يُقيَّد إلا بعد تأكيد البوابة.** لا تُنشئ دالة تزيد
   `walletBalance` مباشرة من مدخلات العميل.
5. **استخدم `increment()` لا قراءة‑ثم‑كتابة** على الحقول الرقمية المشتركة.
6. **الـ Pointer الخام لا يحمل بياناته** — استخدم `fetchPointer()` أو `include()`
   قبل قراءة أي حقل منه.
7. **رسائل الأخطاء بالعربية**، عبر `lib/errors.js` لا `throw new Error`.
8. **`dirty()` وحده لا يصلح حارساً على حقل له `defaultValue`** — Parse يطبّق
   القيمة الافتراضية عند الإنشاء فيُعلّم الحقل مُعدَّلاً. ميّز `isNew()` أولاً.
9. **الآثار الجانبية لا تُسقط العملية** — الإشعار والتدقيق يُسجّلان الفشل
   ويبتلعانه. لا يفشل اعتماد عملٍ منجَز لأن إشعاراً لم يصل.
10. **لا تعديل على `data/mosques.json` يدوياً** — عدّل السكربت وأعد توليده.
11. الكود بالإنجليزية، التعليقات ورسائل المستخدم بالعربية الفصحى.

### القيود المهمة

**تنظيمي — اقرأ هذا قبل لمس مسار التبرعات:**
جمع التبرعات للمساجد في السلطنة يخضع لوزارة الأوقاف والشؤون الدينية ويتطلب
تصريحاً، كما تتطلب بوابة الدفع سجلاً تجارياً وحساباً تاجراً. لذلك:
**المرحلة الأولى تُطلق بمسار التطوّع العيني فقط** (`estimatedCost = 0`)،
بلا أي حركة مالية. كود التبرعات موجود وجاهز لكنه يبقى معطّلاً حتى صدور التصريح.

**تقني:**
- Back4app المجاني: 25k طلب/شهر، قاعدة 250MB. الـ 18k مسجداً تشغل ~15MB — كافٍ.
- الإشعارات تحتاج تسجيل Installation وربطه بالمستخدم عند تسجيل الدخول،
  وإلا لن يصل أي إشعار.
- فهرس `2dsphere` على `Mosques.location` **إلزامي** قبل تشغيل `getNearbyMosques`
  على البيانات الكاملة، وإلا فالاستعلام يمسح 18k وثيقة.

---

## 3. البنية

```
cloud/
  main.js              نقطة الدخول — يُحمّل البقية
  main.bundle.js       الملفات أدناه مدمجة للصق في لوحة Back4app — مولّد، لا يُعدّل
  triggers.js          beforeSave/afterSave: التحقق والحماية
  schema.json          الفئات والحقول والفهارس والصلاحيات
  lib/
    errors.js          أخطاء Parse موحّدة برسائل عربية
    auth.js            التحقق من الأدوار وملكية المسجد
    push.js            الإشعارات (استعلام على _Installation لا _User)
    payments.js        محوّل بوابة ثواني
    audit.js           سجل التدقيق — لا يرمي أبداً
  functions/
    mosques.js         البحث، القرب الجغرافي، طلب ملكية المسجد
    requests.js        دورة حياة الطلب، واهتمام المتطوّعين
    donations.js       التبرع، التأكيد، الصرف، السجل المالي، webhook البوابة
    users.js           اعتماد الشركات، الملف الشخصي، المسجد المفضّل
    maintenance.js     المهام الدورية — تقليم سجل التدقيق
scripts/
  clean_mosques.py     Excel → JSON نظيف
  seed_mosques.js      استيراد إلى Parse (idempotent)
  apply_schema.js      تطبيق schema.json
  build_single_file.py توليد cloud/main.bundle.js من ملفات cloud/
  build_single_doc.py  توليد MASJIDI.md من المستودع كله
tests/
  helpers/parse-mock.js بديل Parse مصغَّر — مخزن في الذاكرة، بلا خادم
  donations.test.js    المسار المالي: التأكيد والحجز
  triggers.test.js     حماية الأدوار وإقفال الحساب على صاحبه
  requests.test.js     دورة حياة الطلب، الإلغاء، التقييم، الصرف
  audit.test.js        سجل التدقيق والمهمة الدورية
  users.test.js        اعتماد الشركات، الاسترداد، البحث، الملف الشخصي
  schema.test.js       الصلاحيات، وتطابق النسختين المجزّأة والمدمجة
  integration/         خادم parse-server حقيقي — `npm run test:integration`
data/
  mosques.json         18,214 سجلاً جاهزاً
  cleaning_report.json تقرير جودة البيانات
app/
  src/api.js           الطبقة الوحيدة التي تلمس Parse — بلا Master Key
  src/screens.jsx      الشاشات
  src/App.jsx          التبويبات حسب الدور
docs/
  PROJECT_SPEC.md      المواصفات الأصلية
  REVIEW.md            الأخطاء التي أُصلحت ولماذا — اقرأه قبل تعديل المنطق المالي
  DATA.md              وصف البيانات ومشاكلها
```

---

## 4. مراجعة الكود الأصلي

المواصفات الأصلية في `PROJECT_SPEC.md` سليمة معمارياً، لكن كود `main.js` فيها
كان يحتوي أخطاء تمنع تشغيله في الإنتاج. هذه قائمة بها مرتّبة بالخطورة.

---

### 🔴 حرج — ثغرات مالية

#### 1. التبرع بدون دفع
```js
// الأصلي
Parse.Cloud.define("fundRequest", async (request) => {
    const { requestId, amount } = request.params;
    mosque.set("walletBalance", currentBalance + amount);   // ← من أين جاء المال؟
```
الدالة تزيد رصيد المسجد بمبلغ يرسله العميل، دون أي تفاعل مع بوابة دفع.
أي شخص يستدعي `fundRequest({amount: 1000000})` من Postman يصبح متبرعاً بمليون ريال.

**الإصلاح:** فُصلت إلى `initiateDonation` (تُنشئ معاملة `pending` + جلسة دفع)
و`confirmDonation` (تتحقق من البوابة ثم تُقيّد). المصدر الوحيد للحقيقة هو
استعلام البوابة، لا مدخلات العميل.

#### 2. الرصيد يصبح NaN
```js
const mosque = serviceReq.get("mosqueId");        // Pointer غير مُحمّل
const currentBalance = mosque.get("walletBalance") || 0;   // undefined → 0
mosque.set("walletBalance", 0 + amount);          // ← مسح الرصيد السابق!
```
الـ Pointer المُعاد من `get()` لا يحمل بياناته. النتيجة أن كل تبرع كان
**يستبدل** الرصيد بدل أن يضيف إليه.

**الإصلاح:** `fetchPointer()` قبل القراءة، و`increment()` الذرّية بدل
قراءة‑ثم‑كتابة (التي تفقد تبرعات متزامنة أصلاً).

#### 3. تمويل جزئي يُعتبر كاملاً
طلب تكلفته 500 ريال يصبح `funded` بتبرع قدره ريال واحد.

**الإصلاح:** حقل `fundedAmount` تراكمي؛ الحالة تتغيّر عند بلوغ `estimatedCost`،
ويُرفض أي مبلغ يتجاوز المتبقي.

---

### 🟠 عالٍ — إشعارات لا تصل أبداً

```js
await Parse.Push.send({ where: { "role": "imam" }, ... });
await Parse.Push.send({ where: { objectId: { $in: userIds } }, ... });
```
`Parse.Push.send` يستعلم على فئة **`_Installation`** (الأجهزة) لا `_User`.
فئة `_Installation` لا تحتوي حقل `role`، و`objectId` فيها معرّف جهاز لا معرّف
مستخدم. الاستعلامان لا يطابقان شيئاً — الإشعارات كانت ستفشل صامتة.

**الإصلاح:** `lib/push.js` يستعلم على `Parse.Installation` بشرط
`containedIn('user', users)`، ما يستلزم ربط الـ Installation بالمستخدم عند
تسجيل الدخول في التطبيق.

كذلك: الإشعار عند التمويل كان يذهب إلى **كل** الأئمة في المنصة، لا إلى إمام
المسجد المعني.

---

### 🟠 عالٍ — ثغرة صلاحيات

```js
Parse.Cloud.define("completeService", async (request) => {
    const query = new Parse.Query("ServiceRequests");
    query.equalTo("mosqueId", mosque);
    const serviceReq = await query.get(requestId, ...);   // ← القيد يُتجاهل
```
`Parse.Query.get()` يتجاهل قيود `equalTo` المضافة قبله. أي إمام كان يستطيع
إقفال طلب يخص مسجد إمام آخر.

**الإصلاح:** جلب الطلب أولاً ثم التحقق اليدوي من الملكية عبر `mosqueForImam()`.

---

### 🟡 متوسط

| المشكلة | الإصلاح |
|---|---|
| `throw new Error()` يفقد كود الخطأ عند العميل | `Parse.Error` بأكواد قياسية — `lib/errors.js` |
| `getNearbyMosques` بلا حد أقصى للنتائج ولا للنطاق | سقف 100 نتيجة و50 كم، مع `select()` للحقول العامة |
| `getMosqueForImam` يفترض مسجداً واحداً لكل إمام | دعم تعدد المساجد مع `mosqueId` صريح |
| لا يوجد تحقق أن `imamId` يحمل الدور `imam` | `beforeSave` على `_User` + مسار `claimMosque` بمراجعة |
| المنفّذ يُقفل الطلب بنفسه | فصل `markWorkDone` (المنفّذ) عن `completeService` (الإمام) |
| `estimatedCost` غير محقّق — يقبل السالب واللانهائي | حدود 0–5000 ريال |
| لا يوجد صرف للشركات ولا سجل مالي | `payoutContractor` + `getMosqueLedger` |
| المستخدم يستطيع تعيين دوره `admin` بنفسه | حظر في `beforeSave` إلا بـ Master Key |
| لا يوجد حد للطلبات المفتوحة | 10 طلبات مفتوحة كحد أقصى للمسجد |

---

### 🔴 جولة ثانية — ثغرات في الكود المُصلَح نفسه

الإصلاحات أعلاه صحيحة في جوهرها، لكن ثلاثاً منها بقيت مفتوحة عند حوافّها.

#### 1. `confirmDonation` بلا تحقق من الملكية — يُضيّع مال المتبرع

```js
Parse.Cloud.define('confirmDonation', async (request) => {
    requireUser(request);                       // ← أي مستخدم مصادَق، لا صاحب المعاملة
    ...
    if (!verification.paid) {
        transaction.set('status', 'failed');    // ← والجلسة قد تكون ما تزال مفتوحة
```

الشرطان معاً يفتحان مساراً لإتلاف تبرّع: يستدعي أي مستخدم مصادَق الدالة على
معاملة غيره **قبل** أن يدفع صاحبها، فالبوابة تردّ `unpaid` فتُعلَّم `failed`.
ثم يدفع المتبرع فعلاً، ويعود للتأكيد فيصطدم بشرط `status === 'pending'` —
المال مقبوض لدى البوابة ولا سبيل لقيده، ولا مسار استرداد في النظام.

**الإصلاح:** التأكيد لصاحب المعاملة وحده أو بـ Master Key (webhook البوابة).
و`verifySession` صارت تميّز الحالة النهائية (`cancelled`/`expired`) من الجلسة
التي ما تزال مفتوحة؛ الثانية تُترك `pending` ليصحّ التأكيد بعد الدفع.

#### 2. سباق التمويل الزائد في `initiateDonation`

```js
const remaining = serviceRequest.get('estimatedCost') - (serviceRequest.get('fundedAmount') || 0);
```

`fundedAmount` لا يعدّ إلا المُقيَّد، فكل متبرّع يرى المتبقي كاملاً متاحاً ما دام
لم يدفع أحد بعد. خمسة متبرّعين يبدأون معاً بـ500 ريال لطلب تكلفته 500 ويدفعون
جميعاً ⇐ تُقبض 2500 ريال بلا استرداد.

**الإصلاح:** نيّات التبرّع المعلّقة تُحجز ضمن المتبقي، بمهلة 30 دقيقة يُفرَج
بعدها عن الحجز حتى لا يُعطّل متبرّعٌ لم يُكمل الدفع تمويلَ الطلب إلى الأبد.
هذا يُضيّق النافذة إلى الطلبات المتزامنة في اللحظة نفسها ولا يُلغيها كلياً —
الإلغاء التام يحتاج قيداً على مستوى قاعدة البيانات.

#### 3. `_User` بلا صلاحيات في المخطط

`schema.json` عرّف `classLevelPermissions` لكل الفئات إلا `_User`، و
`apply_schema.js` لا يستدعي `setCLP` إلا عند وجود المفتاح. النتيجة أن الفئة
تبقى على إعداد الخادم الافتراضي — وقراءة `_User` العامة تكشف `phone` و
`fullName` و`lastKnownLocation`، أي المواقع الجغرافية للمتطوعين.

**الإصلاح:** صلاحيات صريحة في المخطط (`create` مفتوح لأن التسجيل يمرّ عبره،
والقراءة تتطلب مصادقة، و`protectedFields` تُخفي الحقول الحسّاسة)، ومعها
`afterSave` يقفل الـ ACL على صاحب الحساب عند التسجيل. الـ ACL هو الحماية
الفعلية: لا يُضبط في `beforeSave` لأن `objectId` لم يُسنَد بعد عند الإنشاء.

---

### 🔴 جولة رابعة — ما كشفه أول تشغيل على خادم حقيقي

شُغّل الكود على `parse-server` فعليّ فوق PostgreSQL، بالمخطط الحقيقي وبـ200 مسجد
من بيانات الوزارة. الاختبارات الـ87 كانت خضراء، ومع ذلك ظهر خللان لا يستطيع
البديل في الذاكرة رصدهما — كلاهما كان يمنع الإطلاق.

#### 1. لا يستطيع أحد التسجيل إطلاقاً

```js
if (user.dirty('isVerifiedContractor')) {
    throw new Parse.Error(..., 'اعتماد الشركات يتم من الإدارة.');
}
```

`isVerifiedContractor` له `defaultValue` في `schema.json`، وParse يطبّق القيم
الافتراضية عند الإنشاء **فيُعلّم الحقل مُعدَّلاً**. فكان أول تسجيل — لإمام، لا
لشركة — يُردّ برسالة اعتماد الشركات. المنصّة كانت ستُطلق بلا إمكان إنشاء حساب
واحد.

البديل في الذاكرة لا يطبّق قيم المخطط الافتراضية، فالحالة لا تنشأ فيه أصلاً.

**الإصلاح:** الحساب الجديد يبدأ غير معتمد دائماً (`set(false)` بلا رفض)،
والتعديل بعد الإنشاء بـ Master Key وحده. والقاعدة العامة: **`dirty()` وحده لا
يصلح حارساً على حقل له `defaultValue`.**

#### 2. فشل الإشعار يُسقط العملية التي يُبلّغ عنها

`createServiceRequest` يحفظ الطلب ثم يُشعر المتطوّعين القريبين. الاستعلام
الجغرافي فشل (لا فهرس مكاني في تلك البيئة)، فارتفع الخطأ وأسقط الدالة كلها —
**والطلب كان قد حُفظ فعلاً**. فيرى الإمام فشلاً ويُعيد المحاولة فيُنشئ نسخة ثانية.

وهذا ليس افتراضاً بعيداً: `CLAUDE.md` نفسه ينبّه أن فهرس `2dsphere` يُضاف يدوياً
من لوحة Back4app، وأن الإشعارات تحتاج ربط `_Installation` بالمستخدم — فكلا
الشرطين قد يغيب في أول يوم تشغيل.

**الإصلاح:** `lib/push.js` لا يرمي أبداً، أسوةً بـ`lib/audit.js`. الإشعار أثر
جانبي، والفشل يُسجَّل ويُبتلع.

---

### 🟠 جولة خامسة — ما كشفه بناء الواجهة

**البحث لا يُطبّع مصطلح المستخدم.** `nameNormalized` وُجد ليطابق «الرحمة»
بـ«الرحمه»، والبيانات تُخزَّن مطبَّعة عبر `normalize_ar` في سكربت التنظيف —
لكن `searchMosques` كان يرسل النص كما كتبه المستخدم. فالحقل بلا فائدة: من يكتب
الاسم بالتاء المربوطة أو بالهمزة لا يجد شيئاً. ظهر فور أول بحث حقيقي من
الواجهة. **الإصلاح:** `normalizeArabic` في `cloud/functions/mosques.js`، نظير
دالة بايثون حرفاً بحرف — الطرفان يمرّان بالتطبيع نفسه.

---

### ما لم يُعالَج بعد

- **اختبار التكامل يعمل على PostgreSQL لا MongoDB.** `npm run test:integration`
  يُشغّل `parse-server` حقيقياً، لكن Back4app يعمل على MongoDB. المنطق واحد،
  ويبقى خارج التغطية: سلوك الفهارس، والاستعلام الجغرافي (يحتاج PostGIS محلياً
  و`2dsphere` هناك)، وذرّية `increment` تحت التزامن الحقيقي.
- **سرّ الـwebhook يُدار يدوياً.** لا تدوير للمفتاح ولا تحقق من توقيع البوابة
  نفسها (`HMAC`) — السرّ المشترك أضعف من التوقيع لكنه ما تدعمه ثواني حالياً.
- **الاسترداد قيدٌ محاسبي لا تحويل.** `refundDonation` يُعيد الرصيد ويُرجع الطلب
  للتمويل، لكن إعادة المال إلى المتبرّع تتم خارج النظام كما في الصرف. ولا يعمل
  بعد صرف المستحقات — تلك تسوية يدوية.
- **`searchMosques` ما زال يمسح عند البحث بكلمة من وسط الاسم.** البادئة المثبّتة
  تستفيد من الفهرس وهي المسار الأول، لكن `contains` يبقى خطة بديلة لأن المستخدم
  قد يكتب «النور» لا «مسجد النور». الحل التام فهرس نصّي.
- **`externalId_unique` اسم يَعِد بما لا يُنفّذه** — التعريف `{externalId: 1}`
  فهرس عادي، وواجهة مخطط Parse لا تعبّر عن التفرّد. أضِف فهرساً فريداً يدوياً من
  لوحة Back4app؛ حتى ذلك الحين يقوم تفادي التكرار على استعلام‑ثم‑كتابة وحده.
- **التقليم يحذف ولا يؤرشف.** `pruneAuditLog` يُسقط ما تجاوز 180 يوماً بلا نسخة
  خارجية. إن لزم الاحتفاظ الأطول للمساءلة، فالتصدير قبل الحذف مسؤولية خارجية.

---

### 🟡 جولة ثالثة — ما أُغلق بعد ذلك

| المشكلة | الإصلاح |
|---|---|
| `payoutContractor` يقرأ الرصيد ثم يُنقصه، فصرفان متزامنان يجتازان الفحص معاً | الخصم أولاً بـ`increment` الذرّي ثم التحقق، ومع السالب تُعوَّض العملية ويُرفض الصرف. `isPaidOut` يُضبط فور تأمين المبلغ لتضييق نافذة الصرف المزدوج — إغلاقها تماماً يحتاج قيداً في قاعدة البيانات |
| `cancelServiceRequest` يُلغي عملاً قيد التنفيذ بلا إشعار المنفّذ | يُرفض الإلغاء عند `in_progress` و`pending_imam_approval`، ويُشعَر المكلَّف عند إلغاء طلب أُسند إليه |
| المستخدم يغيّر دوره متى شاء عدا `admin` | الدور يُختار عند التسجيل ويُثبَّت بعده؛ تغييره لاحقاً بـ Master Key فقط |
| الإمام لا يعرف مصير طلب ملكيته | `getMyClaims` — الفئة تبقى مقفلة والدالة تُعيد طلباته وحدها |
| `completedJobs` و`avgRating` معرّفان ولا يُكتبان | `completeService` يُحدّث العدد والمتوسط التراكمي للمنفّذ |
| `Number(estimatedCost) \|\| 0` يبتلع NaN فيصير مدخل فاسد طلباً تطوّعياً | تحقق صريح بـ`Number.isFinite` ورفض غير الرقمي |
| لا سجل لتغييرات الحالة، فلا جواب عن "من ألغى هذا الطلب ومتى؟" | فئة `AuditLog` و`lib/audit.js`، والقيد من الدوال لا من `afterSave` — المُشغّل لا يرى الفاعل لأن الحفظ بـ Master Key. القيد لا يُسقط العملية التي يوثّقها، ويُعرَض عبر `getMosqueAuditTrail` بالدور لا بالهوية |
| متبرّع يدفع ثم يُغلق التطبيق فيبقى مالُه غير مقيَّد | `paymentWebhook` يُقيّد لحظة الدفع، ومهمة `reviewPendingDonations` شبكة أمان لما يضيع منه. كلاهما يمرّ بـ`captureDonation` نفسها |
| المولّد يحذف كل سطر `require` بما فيها وحدات Node، فيبقى مرجع غير معرّف في المدمج | الحذف صار مقصوراً على الاستيراد النسبي (`./` و`../`) |
| `AuditLog` ينمو بلا حد على باقة 250 ميغابايت | مهمة `pruneAuditLog` تحذف ما تجاوز 180 يوماً، وبحدّ أدنى 30 يوماً مهما طُلب |

---

## 5. مخطط قاعدة البيانات

احفظه في `cloud/schema.json` وطبّقه عبر السكربت في القسم 9.

```json
{
  "_comment": "مخطط قاعدة البيانات. طبّقه عبر: node scripts/apply_schema.js أو يدوياً من لوحة Back4app.",
  "classes": [
    {
      "className": "Mosques",
      "fields": {
        "externalId": { "type": "String", "required": true },
        "mosqueNumber": { "type": "String" },
        "name": { "type": "String", "required": true },
        "nameNormalized": { "type": "String" },
        "type": { "type": "String" },
        "typeSlug": { "type": "String" },
        "governorate": { "type": "String", "required": true },
        "governorateSlug": { "type": "String" },
        "wilayat": { "type": "String" },
        "village": { "type": "String" },
        "location": { "type": "GeoPoint" },
        "hasLocation": { "type": "Boolean", "defaultValue": true },
        "address": { "type": "String" },
        "imamId": { "type": "Pointer", "targetClass": "_User" },
        "isClaimed": { "type": "Boolean", "defaultValue": false },
        "walletBalance": { "type": "Number", "defaultValue": 0 },
        "openRequestsCount": { "type": "Number", "defaultValue": 0 },
        "dataQuality": { "type": "Object" },
        "source": { "type": "String" }
      },
      "indexes": {
        "externalId_unique": { "externalId": 1 },
        "geo": { "location": "2dsphere" },
        "gov_wilayat": { "governorate": 1, "wilayat": 1 },
        "name_search": { "nameNormalized": 1 }
      },
      "classLevelPermissions": {
        "find": { "requiresAuthentication": true },
        "get": { "requiresAuthentication": true },
        "create": {}, "update": {}, "delete": {},
        "addField": {},
        "protectedFields": { "*": ["walletBalance", "dataQuality"] }
      }
    },
    {
      "className": "MosqueClaims",
      "fields": {
        "mosqueId": { "type": "Pointer", "targetClass": "Mosques", "required": true },
        "imamId": { "type": "Pointer", "targetClass": "_User", "required": true },
        "status": { "type": "String", "defaultValue": "pending" },
        "evidenceNote": { "type": "String" },
        "reviewedBy": { "type": "Pointer", "targetClass": "_User" },
        "reviewedAt": { "type": "Date" }
      },
      "classLevelPermissions": {
        "find": {}, "get": {}, "create": {}, "update": {}, "delete": {}, "addField": {}
      }
    },
    {
      "className": "ServiceRequests",
      "fields": {
        "mosqueId": { "type": "Pointer", "targetClass": "Mosques", "required": true },
        "createdBy": { "type": "Pointer", "targetClass": "_User" },
        "title": { "type": "String", "required": true },
        "description": { "type": "String" },
        "category": { "type": "String" },
        "urgency": { "type": "String", "defaultValue": "normal" },
        "estimatedCost": { "type": "Number", "defaultValue": 0 },
        "fundedAmount": { "type": "Number", "defaultValue": 0 },
        "status": { "type": "String", "required": true },
        "assignedVolunteerId": { "type": "Pointer", "targetClass": "_User" },
        "assignedContractorId": { "type": "Pointer", "targetClass": "_User" },
        "isFundedByDonors": { "type": "Boolean", "defaultValue": false },
        "isPaidOut": { "type": "Boolean", "defaultValue": false },
        "workerNotes": { "type": "String" },
        "completionPhotos": { "type": "Array" },
        "imamRating": { "type": "Number" },
        "volunteerHours": { "type": "Number", "defaultValue": 0 },
        "assignedAt": { "type": "Date" },
        "startedAt": { "type": "Date" },
        "workDoneAt": { "type": "Date" },
        "fundedAt": { "type": "Date" },
        "imamApprovalDate": { "type": "Date" },
        "cancelledAt": { "type": "Date" }
      },
      "indexes": {
        "status_mosque": { "status": 1, "mosqueId": 1 },
        "open_feed": { "status": 1, "createdAt": -1 }
      },
      "classLevelPermissions": {
        "find": { "requiresAuthentication": true },
        "get": { "requiresAuthentication": true },
        "create": {}, "update": {}, "delete": {}, "addField": {}
      }
    },
    {
      "className": "Transactions",
      "fields": {
        "donorId": { "type": "Pointer", "targetClass": "_User" },
        "payeeId": { "type": "Pointer", "targetClass": "_User" },
        "mosqueId": { "type": "Pointer", "targetClass": "Mosques", "required": true },
        "requestId": { "type": "Pointer", "targetClass": "ServiceRequests" },
        "amount": { "type": "Number", "required": true },
        "type": { "type": "String", "required": true },
        "status": { "type": "String", "defaultValue": "pending" },
        "paymentSessionId": { "type": "String" },
        "paymentGatewayRef": { "type": "String" },
        "approvedBy": { "type": "Pointer", "targetClass": "_User" },
        "capturedAt": { "type": "Date" }
      },
      "indexes": {
        "session": { "paymentSessionId": 1 },
        "ledger": { "mosqueId": 1, "status": 1, "createdAt": -1 }
      },
      "classLevelPermissions": {
        "find": { "requiresAuthentication": true },
        "get": { "requiresAuthentication": true },
        "create": {}, "update": {}, "delete": {}, "addField": {},
        "protectedFields": { "*": ["donorId", "paymentSessionId", "paymentGatewayRef"] }
      }
    },
    {
      "className": "TaskInterests",
      "_comment": "اهتمام متطوّع بطلب مفتوح. لا يُسند الطلب — الإمام يختار عبر assignWorker.",
      "fields": {
        "requestId": { "type": "Pointer", "targetClass": "ServiceRequests", "required": true },
        "volunteerId": { "type": "Pointer", "targetClass": "_User", "required": true },
        "note": { "type": "String" },
        "status": { "type": "String", "defaultValue": "active" }
      },
      "indexes": {
        "by_request": { "requestId": 1, "status": 1 },
        "by_volunteer": { "volunteerId": 1, "createdAt": -1 }
      },
      "classLevelPermissions": {
        "find": {}, "get": {}, "create": {}, "update": {}, "delete": {}, "addField": {}
      }
    },
    {
      "className": "AuditLog",
      "_comment": "سجل التدقيق. مقفل على Master Key ويُقرأ عبر getMosqueAuditTrail وحدها، فلا تُكشف هوية الفاعل.",
      "fields": {
        "action": { "type": "String", "required": true },
        "targetClass": { "type": "String" },
        "targetId": { "type": "String" },
        "mosqueId": { "type": "Pointer", "targetClass": "Mosques" },
        "fromStatus": { "type": "String" },
        "toStatus": { "type": "String" },
        "actorId": { "type": "Pointer", "targetClass": "_User" },
        "actorRole": { "type": "String" },
        "amount": { "type": "Number" }
      },
      "indexes": {
        "trail": { "mosqueId": 1, "createdAt": -1 }
      },
      "classLevelPermissions": {
        "find": {}, "get": {}, "create": {}, "update": {}, "delete": {}, "addField": {}
      }
    },
    {
      "className": "_User",
      "fields": {
        "role": { "type": "String", "defaultValue": "donor" },
        "fullName": { "type": "String" },
        "phone": { "type": "String" },
        "skills": { "type": "Array" },
        "governorate": { "type": "String" },
        "wilayat": { "type": "String" },
        "lastKnownLocation": { "type": "GeoPoint" },
        "favoriteMosqueId": { "type": "Pointer", "targetClass": "Mosques" },
        "isActive": { "type": "Boolean", "defaultValue": true },
        "isVerifiedContractor": { "type": "Boolean", "defaultValue": false },
        "companyName": { "type": "String" },
        "crNumber": { "type": "String" },
        "completedJobs": { "type": "Number", "defaultValue": 0 },
        "avgRating": { "type": "Number" }
      },
      "indexes": {
        "role_gov": { "role": 1, "governorate": 1 },
        "volunteer_geo": { "lastKnownLocation": "2dsphere" }
      },
      "_comment_clp": "create مفتوح لأن التسجيل يمرّ عبره. الحماية الفعلية في ACL يضبطه afterSave على المستخدم نفسه، وقراءة بيانات مستخدم آخر تمرّ عبر دوال السحابة بـ Master Key.",
      "classLevelPermissions": {
        "find": { "requiresAuthentication": true },
        "get": { "requiresAuthentication": true },
        "create": { "*": true },
        "update": { "requiresAuthentication": true },
        "delete": { "requiresAuthentication": true },
        "addField": {},
        "protectedFields": { "*": ["phone", "lastKnownLocation", "crNumber"] }
      }
    }
  ]
}
```

---

## 6. كود السحابة كاملاً

### 6أ — النسخة المجزّأة (لإعادة بناء المستودع)

الملفات كما هي على القرص، بكامل `require` و`module.exports`. هذه هي النسخة
التي تُفكَّك إلى البنية الموصوفة في القسم 3. المخطط `cloud/schema.json` في
القسم 5.

#### `cloud/main.js`

```javascript
/**
 * مسجدي — نقطة دخول Cloud Code
 *
 * Back4app / Parse Server يُحمّل هذا الملف عند النشر.
 * الترتيب مهم: triggers أولاً ثم الدوال.
 */

require('./triggers');
require('./functions/mosques');
require('./functions/requests');
require('./functions/donations');
require('./functions/users');
require('./functions/maintenance');

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: require('./lib/payments').isConfigured(),
}));
```

#### `cloud/triggers.js`

```javascript
const { ROLES } = require('./lib/auth');

/** لا يُسمح للعميل بتعيين دوره بنفسه إلى admin، ولا بتعديل الحقول الحسّاسة. */
Parse.Cloud.beforeSave(Parse.User, async (request) => {
  const user = request.object;

  if (user.isNew() && !user.get('role')) user.set('role', 'donor');

  const role = user.get('role');
  if (role && !ROLES.includes(role)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'دور غير معروف.');
  }

  // الترقية إلى admin أو اعتماد الشركات يتم عبر Master Key فقط
  if (!request.master) {
    if (user.dirty('role')) {
      if (role === 'admin') {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
      }
      // الدور يُختار عند التسجيل ويُثبَّت بعده. تركُه مفتوحاً يعني أن متبرعاً
      // يصبح إماماً أو شركةً متى شاء، فلا يصلح الدور أساساً لأي تفويض لاحق.
      if (!user.isNew()) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تغيير الدور يتم من الإدارة.');
      }
    }
    // ⚠️ `dirty()` وحده لا يصلح حارساً على حقل له `defaultValue` في المخطط:
    // Parse يطبّق القيمة الافتراضية عند الإنشاء فيُعلّم الحقل مُعدَّلاً، فكان
    // هذا الشرط يرفض **كل تسجيل جديد** برسالة اعتماد الشركات. الصواب: الحساب
    // الجديد يبدأ غير معتمد دائماً، والتعديل بعد ذلك بـ Master Key وحده.
    if (user.isNew()) {
      user.set('isVerifiedContractor', false);
    } else if (user.dirty('isVerifiedContractor')) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'اعتماد الشركات يتم من الإدارة.');
    }
  }

  if (user.isNew()) user.set('isActive', true);
});

/**
 * إقفال المستخدم الجديد على نفسه.
 *
 * الـ CLP وحده لا يكفي: افتراض Parse أن يمنح المستخدم الجديد قراءة عامة، فيصبح
 * `phone` و`lastKnownLocation` (موقع المتطوع) مقروءاً لكل من يملك مفتاح العميل.
 * الـ ACL لا يُضبط في beforeSave لأن `objectId` لم يُسنَد بعد عند الإنشاء.
 * قراءة بيانات مستخدم آخر تبقى ممكنة من دوال السحابة عبر Master Key.
 */
Parse.Cloud.afterSave(Parse.User, async (request) => {
  if (request.original) return; // تحديث، لا إنشاء — وهو أيضاً ما يمنع الحلقة اللانهائية

  const user = request.object;
  const acl = user.getACL();
  if (acl && !acl.getPublicReadAccess() && !acl.getPublicWriteAccess()) return;

  const own = new Parse.ACL();
  own.setReadAccess(user.id, true);
  own.setWriteAccess(user.id, true);
  user.setACL(own);
  await user.save(null, { useMasterKey: true });
});

/** الرصيد والحالات لا تُعدّل إلا من دوال السحابة. */
Parse.Cloud.beforeSave('Mosques', async (request) => {
  const mosque = request.object;
  if (!request.master && (mosque.dirty('walletBalance') || mosque.dirty('imamId') || mosque.dirty('isClaimed'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تعديل غير مسموح من التطبيق.');
  }
  if ((mosque.get('walletBalance') || 0) < 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'الرصيد لا يمكن أن يكون سالباً.');
  }
});

Parse.Cloud.beforeSave('ServiceRequests', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'الطلبات تُنشأ وتُحدّث عبر دوال السحابة فقط.');
  }
});

Parse.Cloud.beforeSave('Transactions', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'المعاملات المالية تُنشأ عبر دوال السحابة فقط.');
  }
  if (!request.object.isNew() && request.object.get('status') === 'captured' && request.object.dirty('amount')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'لا يجوز تعديل مبلغ معاملة مُقيّدة.');
  }
});

/** عدّاد الطلبات المفتوحة للعرض السريع في الخريطة. */
Parse.Cloud.afterSave('ServiceRequests', async (request) => {
  const serviceRequest = request.object;
  const previous = request.original ? request.original.get('status') : null;
  if (previous === serviceRequest.get('status')) return;

  const mosquePointer = serviceRequest.get('mosqueId');
  if (!mosquePointer) return;

  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosquePointer)
    .containedIn('status', ['pending_funding', 'open_for_volunteers', 'funded', 'assigned', 'in_progress'])
    .count({ useMasterKey: true });

  const mosque = await mosquePointer.fetch({ useMasterKey: true });
  mosque.set('openRequestsCount', openCount);
  await mosque.save(null, { useMasterKey: true });
});
```

#### `cloud/lib/errors.js`

```javascript
/**
 * أخطاء موحّدة برسائل عربية وأكواد Parse قياسية.
 * لا تستخدم `throw new Error(...)` في دوال السحابة — العميل يفقد كود الخطأ.
 */

const CODES = {
  INVALID_SESSION: Parse.Error.INVALID_SESSION_TOKEN, // 209
  VALIDATION: Parse.Error.VALIDATION_ERROR, // 142
  NOT_FOUND: Parse.Error.OBJECT_NOT_FOUND, // 101
  FORBIDDEN: Parse.Error.OPERATION_FORBIDDEN, // 119
  DUPLICATE: Parse.Error.DUPLICATE_VALUE, // 137
};

function fail(code, messageAr) {
  throw new Parse.Error(code, messageAr);
}

module.exports = {
  CODES,
  fail,
  unauthenticated: () => fail(CODES.INVALID_SESSION, 'يجب تسجيل الدخول أولاً.'),
  forbidden: (m) => fail(CODES.FORBIDDEN, m || 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'),
  invalid: (m) => fail(CODES.VALIDATION, m || 'البيانات المُرسلة غير صحيحة.'),
  notFound: (m) => fail(CODES.NOT_FOUND, m || 'العنصر المطلوب غير موجود.'),
  duplicate: (m) => fail(CODES.DUPLICATE, m || 'هذا العنصر مسجّل مسبقاً.'),
};
```

#### `cloud/lib/auth.js`

```javascript
const E = require('./errors');

const ROLES = ['imam', 'volunteer', 'donor', 'contractor', 'admin'];

/** يتحقق من وجود جلسة صالحة ويعيد المستخدم. */
function requireUser(request) {
  const user = request.user;
  if (!user) E.unauthenticated();
  return user;
}

/**
 * يتحقق أن المستخدم يحمل أحد الأدوار المطلوبة.
 * ملاحظة أمنية: نقرأ الدور من الكائن المخزّن لا من request.params أبداً.
 */
function requireRole(request, ...roles) {
  const user = requireUser(request);
  const role = user.get('role');
  if (!roles.includes(role)) {
    E.forbidden(`هذه الخاصية متاحة لـ: ${roles.join('، ')} فقط.`);
  }
  return user;
}

/**
 * يعيد المسجد الذي يديره هذا الإمام.
 * الإمام قد يدير أكثر من مسجد، لذا نطلب mosqueId صراحةً عند وجود أكثر من واحد.
 */
async function mosqueForImam(imam, mosqueId) {
  const query = new Parse.Query('Mosques');
  query.equalTo('imamId', imam);
  query.equalTo('isClaimed', true);

  if (mosqueId) {
    query.equalTo('objectId', mosqueId);
    const mosque = await query.first({ useMasterKey: true });
    if (!mosque) E.forbidden('هذا المسجد غير مسجّل باسمك.');
    return mosque;
  }

  const mosques = await query.limit(2).find({ useMasterKey: true });
  if (mosques.length === 0) E.notFound('لا يوجد مسجد مسجّل باسمك بعد.');
  if (mosques.length > 1) E.invalid('تدير أكثر من مسجد — أرسل mosqueId مع الطلب.');
  return mosques[0];
}

/** جلب كائن مُشار إليه (Pointer) بشكل آمن — الـ Pointer الخام لا يحمل بياناته. */
async function fetchPointer(pointer, className) {
  if (!pointer) E.notFound(`${className} غير مرتبط بهذا السجل.`);
  if (pointer.get && pointer.get('createdAt') !== undefined && pointer.attributes && Object.keys(pointer.attributes).length > 0) {
    return pointer; // مُحمّل مسبقاً عبر include()
  }
  return pointer.fetch({ useMasterKey: true });
}

module.exports = { ROLES, requireUser, requireRole, mosqueForImam, fetchPointer };
```

#### `cloud/lib/push.js`

```javascript
/**
 * الإشعارات.
 *
 * ⚠️ خطأ شائع في الملف الأصلي: Parse.Push.send يستعلم على فئة _Installation
 * وليس على _User. لذلك `where: { role: "imam" }` لا يطابق شيئاً أبداً،
 * و `where: { objectId: { $in: [userIds] } }` يقارن معرّفات مستخدمين
 * بمعرّفات أجهزة. الصحيح: الاستعلام على حقل الـ pointer `user` داخل _Installation.
 *
 * شرط التشغيل: عند تسجيل الدخول في التطبيق يجب حفظ Installation
 * وربطه بالمستخدم:  installation.set('user', Parse.User.current())
 */

async function pushToUsers(users, payload) {
  const list = (Array.isArray(users) ? users : [users]).filter(Boolean);
  if (list.length === 0) return { sent: 0 };

  const installations = new Parse.Query(Parse.Installation);
  installations.containedIn('user', list);
  installations.limit(1000);

  try {
    await Parse.Push.send(
      {
        where: installations,
        data: { sound: 'default', ...payload },
      },
      { useMasterKey: true }
    );
  } catch (error) {
    // مقصود: الإشعار أثر جانبي لا يجوز أن يُسقط العملية التي يُبلّغ عنها
    console.error('[push] تعذّر الإرسال:', error && error.message);
    return { sent: 0, failed: true };
  }
  return { sent: list.length };
}

/** متطوعون قريبون: نطاق جغرافي أولاً، ثم المحافظة كخطة بديلة. */
async function pushToNearbyVolunteers(mosque, payload, radiusKm = 15) {
  const base = new Parse.Query(Parse.User);
  base.equalTo('role', 'volunteer');
  base.equalTo('isActive', true);

  const location = mosque.get('location');
  let volunteers = [];

  try {
    if (location) {
      const geo = new Parse.Query(Parse.User);
      geo.equalTo('role', 'volunteer');
      geo.equalTo('isActive', true);
      geo.withinKilometers('lastKnownLocation', location, radiusKm);
      geo.limit(500);
      volunteers = await geo.find({ useMasterKey: true });
    }

    if (volunteers.length === 0) {
      base.equalTo('governorate', mosque.get('governorate'));
      base.limit(500);
      volunteers = await base.find({ useMasterKey: true });
    }
  } catch (error) {
    // الاستعلام الجغرافي يفشل إن غاب فهرس `2dsphere` — وغيابه وارد: يُضاف
    // يدوياً من لوحة Back4app. لا يجوز أن يُسقط ذلك إنشاء طلب صيانة.
    console.error('[push] تعذّر جلب المتطوّعين القريبين:', error && error.message);
    return { sent: 0, failed: true };
  }

  return pushToUsers(volunteers, payload);
}

module.exports = { pushToUsers, pushToNearbyVolunteers };
```

#### `cloud/lib/payments.js`

```javascript
/**
 * محوّل بوابة الدفع.
 *
 * قاعدة ذهبية: لا يُضاف أي مبلغ إلى رصيد المسجد إلا بعد تأكيد البوابة.
 * التدفق الصحيح:
 *   1) initiateDonation  → إنشاء معاملة بحالة "pending" + جلسة دفع.
 *   2) المستخدم يدفع في صفحة البوابة.
 *   3) webhook أو التحقق اليدوي → confirmDonation → الحالة "captured" + تحديث الرصيد.
 *
 * البوابات المتاحة في عُمان: Thawani (الأكثر شيوعاً)، OmanNet عبر البنوك،
 * وAmwal. جميعها تتطلب سجلاً تجارياً وحساباً تاجراً.
 *
 * ⚠️ تنبيه تنظيمي مهم قبل تفعيل التبرعات:
 * جمع التبرعات للمساجد في السلطنة يخضع لوزارة الأوقاف والشؤون الدينية،
 * ويحتاج تصريح جمع تبرعات. لا تُفعّل هذا المسار في الإنتاج قبل الحصول
 * على الموافقة. يمكن إطلاق النسخة الأولى بمسار التطوّع العيني فقط
 * (estimatedCost = 0) دون أي حركة مالية — وهذا هو المسار الموصى به للـ MVP.
 */

const THAWANI_BASE = process.env.THAWANI_BASE_URL || 'https://uatcheckout.thawani.om/api/v1';
const THAWANI_SECRET = process.env.THAWANI_SECRET_KEY;
const THAWANI_PUBLISHABLE = process.env.THAWANI_PUBLISHABLE_KEY;

const BAISA_PER_OMR = 1000; // ثواني تتعامل بالبيسة (عدد صحيح)

function isConfigured() {
  return Boolean(THAWANI_SECRET && THAWANI_PUBLISHABLE);
}

/**
 * إنشاء جلسة دفع. يعيد { sessionId, redirectUrl }.
 * clientReferenceId هو مفتاح المنع المزدوج (idempotency) — نمرّر معرّف المعاملة.
 */
async function createCheckoutSession({ amountOmr, clientReferenceId, description, successUrl, cancelUrl }) {
  if (!isConfigured()) {
    throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'بوابة الدفع غير مهيأة على الخادم.');
  }

  const response = await Parse.Cloud.httpRequest({
    method: 'POST',
    url: `${THAWANI_BASE}/checkout/session`,
    headers: { 'Content-Type': 'application/json', 'thawani-api-key': THAWANI_SECRET },
    body: {
      client_reference_id: clientReferenceId,
      mode: 'payment',
      products: [{ name: description, quantity: 1, unit_amount: Math.round(amountOmr * BAISA_PER_OMR) }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  });

  const session = response.data.data;
  return {
    sessionId: session.session_id,
    redirectUrl: `${THAWANI_BASE.replace('/api/v1', '')}/pay/${session.session_id}?key=${THAWANI_PUBLISHABLE}`,
  };
}

/**
 * حالات "غير مدفوع" النهائية: لا أمل في اكتمال الدفع بعدها.
 * ما عداها (unpaid مثلاً) يعني أن الجلسة ما تزال مفتوحة والمستخدم قد يدفع لاحقاً.
 * التمييز ضروري: تعليم معاملة `failed` وهي ما تزال قابلة للدفع يُسقطها من
 * شرط `pending` في confirmDonation، فيدفع المتبرع ولا يُقيَّد مبلغه أبداً.
 */
const TERMINAL_UNPAID = ['cancelled', 'canceled', 'expired', 'failed', 'refunded'];

/** التحقق من حالة الجلسة لدى البوابة — المصدر الوحيد للحقيقة. */
async function verifySession(sessionId) {
  const response = await Parse.Cloud.httpRequest({
    method: 'GET',
    url: `${THAWANI_BASE}/checkout/session/${sessionId}`,
    headers: { 'thawani-api-key': THAWANI_SECRET },
  });

  const session = response.data.data;
  const status = String(session.payment_status || '').toLowerCase();
  return {
    paid: status === 'paid',
    terminal: TERMINAL_UNPAID.includes(status),
    status,
    amountOmr: (session.total_amount || 0) / BAISA_PER_OMR,
    reference: session.invoice || session.session_id,
    raw: session,
  };
}

module.exports = { isConfigured, createCheckoutSession, verifySession, BAISA_PER_OMR };
```

#### `cloud/lib/audit.js`

```javascript
/**
 * سجل التدقيق.
 *
 * وعد المنصّة للمتبرّع هو الشفافية، و`getMosqueLedger` يُظهر المال وحده: من
 * تبرّع بكم ومتى صُرف. لا يُظهر من غيّر حالة الطلب ولا متى، فلا سبيل للإجابة
 * عن "من ألغى هذا الطلب؟" أو "متى اعتُمد العمل ومن اعتمده؟".
 *
 * قيدان في التصميم:
 *
 * 1) **القيد لا يُسقط العملية أبداً.** فشل الكتابة هنا يُسجَّل في السجلّ ويُبتلع
 *    — لا يجوز أن يفشل اعتماد عملٍ منجَز لأن سطر تدقيق لم يُكتب.
 * 2) **يُستدعى صراحةً من الدوال لا من `afterSave`.** المُشغّل يرى تغيّر الحالة
 *    لكنه لا يرى الفاعل: الحفظ يجري بـ Master Key فيصل `request.user` فارغاً.
 *
 * تنبيه على التكلفة: كل قيد كتابةٌ إضافية. باقة Back4app المجانية 25 ألف طلب
 * شهرياً، فالقيد مقصور على تحوّلات الحالة وحركات المال لا على كل حفظ.
 */

const ACTIONS = {
  REQUEST_CREATED: 'request_created',
  INTEREST_EXPRESSED: 'interest_expressed',
  INTEREST_WITHDRAWN: 'interest_withdrawn',
  WORKER_ASSIGNED: 'worker_assigned',
  WORK_STARTED: 'work_started',
  WORK_DONE: 'work_done',
  REQUEST_COMPLETED: 'request_completed',
  REQUEST_CANCELLED: 'request_cancelled',
  DONATION_CAPTURED: 'donation_captured',
  DONATION_EXPIRED: 'donation_expired',
  PAYOUT_RECORDED: 'payout_recorded',
  CLAIM_REVIEWED: 'claim_reviewed',
  CONTRACTOR_REVIEWED: 'contractor_reviewed',
  DONATION_REFUNDED: 'donation_refunded',
};

/**
 * قيد سطر تدقيق واحد.
 *
 * @param {object}  entry
 * @param {string}  entry.action      من `ACTIONS`
 * @param {object=} entry.target      الكائن المتأثّر (طلب، معاملة، …)
 * @param {object=} entry.mosque      المسجد — مفتاح عرض السجل
 * @param {object=} entry.actor       المستخدم الفاعل، أو لا شيء للنظام
 * @param {string=} entry.fromStatus
 * @param {string=} entry.toStatus
 * @param {number=} entry.amount
 */
async function record({ action, target, mosque, actor, fromStatus, toStatus, amount }) {
  try {
    const Entry = Parse.Object.extend('AuditLog');
    const entry = new Entry();

    entry.set('action', action);
    if (target) {
      entry.set('targetClass', target.className);
      entry.set('targetId', target.id);
    }
    if (mosque) entry.set('mosqueId', mosque);
    if (actor) {
      entry.set('actorId', actor);
      entry.set('actorRole', actor.get('role') || null);
    }
    if (fromStatus) entry.set('fromStatus', fromStatus);
    if (toStatus) entry.set('toStatus', toStatus);
    if (typeof amount === 'number') entry.set('amount', amount);

    await entry.save(null, { useMasterKey: true });
  } catch (error) {
    // مقصود: التدقيق لا يُسقط العملية التي يوثّقها
    console.error('[audit] تعذّر قيد السطر:', action, error && error.message);
  }
}

module.exports = { record, ACTIONS };
```

#### `cloud/functions/mosques.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');
const audit = require('../lib/audit');

const PUBLIC_FIELDS = [
  'name', 'mosqueNumber', 'type', 'typeSlug', 'governorate', 'wilayat',
  'village', 'location', 'isClaimed', 'openRequestsCount',
];

/**
 * المساجد القريبة.
 * إصلاحات مقابل النسخة الأصلية: حد أقصى للنتائج، تحديد الحقول المُعادة،
 * سقف لنصف القطر، ولا نُعيد كائنات كاملة بصلاحيات Master.
 */
Parse.Cloud.define('getNearbyMosques', async (request) => {
  requireUser(request);
  const { lat, lng, radius = 5, limit = 50 } = request.params;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    E.invalid('الإحداثيات (lat, lng) مطلوبة كأرقام.');
  }
  const radiusKm = Math.min(Math.max(Number(radius) || 5, 0.5), 50);

  const point = new Parse.GeoPoint({ latitude: lat, longitude: lng });
  const query = new Parse.Query('Mosques');
  query.withinKilometers('location', point, radiusKm, true); // sorted = true
  query.select(...PUBLIC_FIELDS);
  query.limit(Math.min(Number(limit) || 50, 100));

  const results = await query.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
});

/**
 * تطبيع النص العربي — نظير `normalize_ar` في `scripts/clean_mosques.py`.
 *
 * البيانات مخزَّنة مطبَّعة في `nameNormalized`، وكان البحث يُرسل النص كما كتبه
 * المستخدم: فمن يكتب «الرحمة» لا يجد «الرحمه»، وهي المشكلة التي وُجد الحقل
 * لحلّها. الطرفان يجب أن يمرّا بالتطبيع نفسه، وإلا فالحقل بلا فائدة.
 */
function normalizeArabic(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '') // التشكيل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** بحث نصّي بالاسم أو القرية داخل ولاية/محافظة. */
Parse.Cloud.define('searchMosques', async (request) => {
  requireUser(request);
  const { term, governorate, wilayat, limit = 30 } = request.params;

  const cleaned = term ? normalizeArabic(term) : '';
  const cap = Math.min(Number(limit) || 30, 100);

  /** قيود المحافظة والولاية مشتركة بين المحاولتين. */
  const scoped = () => {
    const query = new Parse.Query('Mosques');
    if (governorate) query.equalTo('governorate', governorate);
    if (wilayat) query.equalTo('wilayat', wilayat);
    query.select(...PUBLIC_FIELDS);
    query.limit(cap);
    return query;
  };

  if (cleaned.length < 2) {
    const all = await scoped().find({ useMasterKey: true });
    return all.map((m) => m.toJSON());
  }

  // البادئة المثبّتة وحدها تستفيد من فهرس `nameNormalized`. `contains` يولّد
  // `$regex` غير مثبّت فيمسح المجموعة كاملة (18 ألف وثيقة) — يبقى خطة بديلة
  // لأن المستخدم قد يبحث بكلمة من وسط الاسم، لا احتمالاً أولَ.
  const byPrefix = scoped();
  byPrefix.startsWith('nameNormalized', cleaned);
  const prefixHits = await byPrefix.find({ useMasterKey: true });
  if (prefixHits.length > 0) return prefixHits.map((m) => m.toJSON());

  const bySubstring = scoped();
  bySubstring.contains('nameNormalized', cleaned);
  const results = await bySubstring.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
});

/**
 * طلب ملكية مسجد (الإمام يربط نفسه بمسجد من قاعدة بيانات الوزارة).
 * لا يُعتمد تلقائياً — يبقى معلقاً حتى موافقة المشرف، لأن ربط شخص بمسجد
 * يمنحه لاحقاً صلاحية استقبال تبرعات.
 */
Parse.Cloud.define('claimMosque', async (request) => {
  const imam = requireRole(request, 'imam');
  const { mosqueId, evidenceNote } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = await new Parse.Query('Mosques').get(mosqueId, { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  if (mosque.get('isClaimed')) E.duplicate('هذا المسجد مسجّل لإمام آخر بالفعل.');

  const existing = await new Parse.Query('MosqueClaims')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'pending')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('يوجد طلب ملكية معلّق لهذا المسجد.');

  const Claim = Parse.Object.extend('MosqueClaims');
  const claim = new Claim();
  claim.set('mosqueId', mosque);
  claim.set('imamId', imam);
  claim.set('status', 'pending');
  claim.set('evidenceNote', String(evidenceNote || '').slice(0, 500));
  await claim.save(null, { useMasterKey: true });

  return { message: 'تم استلام طلبك، سيُراجع خلال أيام عمل.', claimId: claim.id };
});

/**
 * طلبات الملكية الخاصة بالإمام المستدعي.
 * `MosqueClaims` مقفلة على Master Key، فبلا هذه الدالة لا يعرف الإمام أبداً
 * إن كان طلبه قد اعتُمد أو رُفض.
 */
Parse.Cloud.define('getMyClaims', async (request) => {
  const imam = requireRole(request, 'imam');

  const claims = await new Parse.Query('MosqueClaims')
    .equalTo('imamId', imam)
    .include('mosqueId')
    .descending('createdAt')
    .limit(20)
    .find({ useMasterKey: true });

  return claims.map((claim) => {
    const mosque = claim.get('mosqueId');
    return {
      id: claim.id,
      status: claim.get('status'),
      evidenceNote: claim.get('evidenceNote'),
      createdAt: claim.get('createdAt'),
      reviewedAt: claim.get('reviewedAt'),
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
    };
  });
});

/** اعتماد أو رفض طلب الملكية (مشرف فقط). */
Parse.Cloud.define('reviewMosqueClaim', async (request) => {
  const admin = requireRole(request, 'admin');
  const { claimId, approve } = request.params;

  const claim = await new Parse.Query('MosqueClaims').include('mosqueId').include('imamId')
    .get(claimId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (claim.get('status') !== 'pending') E.invalid('تمت مراجعة هذا الطلب مسبقاً.');

  claim.set('status', approve ? 'approved' : 'rejected');
  claim.set('reviewedBy', admin);
  claim.set('reviewedAt', new Date());
  await claim.save(null, { useMasterKey: true });

  if (approve) {
    const mosque = claim.get('mosqueId');
    mosque.set('imamId', claim.get('imamId'));
    mosque.set('isClaimed', true);
    await mosque.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.CLAIM_REVIEWED,
    target: claim,
    mosque: claim.get('mosqueId'),
    actor: admin,
    toStatus: claim.get('status'),
  });

  return { status: claim.get('status') };
});
```

#### `cloud/functions/requests.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole, mosqueForImam, fetchPointer } = require('../lib/auth');
const { pushToUsers, pushToNearbyVolunteers } = require('../lib/push');
const audit = require('../lib/audit');

/**
 * دورة حياة الطلب:
 *   pending_funding → funded → assigned → in_progress → pending_imam_approval → completed
 *   (أو) open_for_volunteers → assigned → ... (مسار التطوّع العيني، بلا مال)
 *   يمكن الإلغاء في أي مرحلة قبل التنفيذ → cancelled
 */
const STATUS = {
  PENDING_FUNDING: 'pending_funding',
  OPEN_FOR_VOLUNTEERS: 'open_for_volunteers',
  FUNDED: 'funded',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  PENDING_APPROVAL: 'pending_imam_approval',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const MAX_ESTIMATE_OMR = 5000;

Parse.Cloud.define('createServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const mosque = await mosqueForImam(imam, request.params.mosqueId);

  const { title, description, category, estimatedCost, urgency } = request.params;
  if (!title || String(title).trim().length < 3) E.invalid('العنوان مطلوب (3 أحرف فأكثر).');
  if (!description || String(description).trim().length < 10) E.invalid('الوصف مطلوب (10 أحرف فأكثر).');

  // `Number(x) || 0` كان يبتلع NaN فيحوّل مدخلاً فاسداً إلى طلب تطوّعي بصمت
  const cost = estimatedCost === undefined || estimatedCost === null ? 0 : Number(estimatedCost);
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون رقماً بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
  }

  // منع إغراق النظام: حد أقصى للطلبات المفتوحة لكل مسجد
  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosque)
    .containedIn('status', [STATUS.PENDING_FUNDING, STATUS.OPEN_FOR_VOLUNTEERS, STATUS.FUNDED, STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openCount >= 10) E.invalid('لديك 10 طلبات مفتوحة — أغلق بعضها قبل إضافة طلب جديد.');

  const ServiceRequest = Parse.Object.extend('ServiceRequests');
  const serviceRequest = new ServiceRequest();
  serviceRequest.set('mosqueId', mosque);
  serviceRequest.set('createdBy', imam);
  serviceRequest.set('title', String(title).trim().slice(0, 120));
  serviceRequest.set('description', String(description).trim().slice(0, 2000));
  serviceRequest.set('category', category || 'other'); // electrical | plumbing | ac | paint | cleaning | carpet | other
  serviceRequest.set('urgency', urgency || 'normal'); // low | normal | high
  serviceRequest.set('estimatedCost', cost);
  serviceRequest.set('fundedAmount', 0);
  serviceRequest.set('status', cost > 0 ? STATUS.PENDING_FUNDING : STATUS.OPEN_FOR_VOLUNTEERS);

  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CREATED,
    target: serviceRequest,
    mosque,
    actor: imam,
    toStatus: serviceRequest.get('status'),
  });

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

const MAX_INTEREST_NOTE = 300;

/**
 * المتطوّع يُسجّل اهتمامه بطلب مفتوح.
 *
 * لا يُسند الطلب ولا يُغيّر حالته: الإمام يبقى صاحب القرار عبر `assignWorker`.
 * بدون هذا المسار يرى المتطوّع الفرصة القريبة ولا يملك وسيلة للتعبير عنها
 * أصلاً — وهي أكبر فجوة في مسار التطوّع العيني، وهو المسار القابل للإطلاق.
 */
Parse.Cloud.define('expressInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId, note } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.OPEN_FOR_VOLUNTEERS) {
    E.invalid('هذا الطلب لا يستقبل المتطوّعين حالياً.');
  }

  const existing = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('سبق أن سجّلت اهتمامك بهذا الطلب.');

  const Interest = Parse.Object.extend('TaskInterests');
  const interest = new Interest();
  interest.set('requestId', serviceRequest);
  interest.set('volunteerId', volunteer);
  interest.set('status', 'active');
  interest.set('note', String(note || '').trim().slice(0, MAX_INTEREST_NOTE));
  await interest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.INTEREST_EXPRESSED,
    target: interest,
    mosque,
    actor: volunteer,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `متطوّع مهتمّ بـ "${serviceRequest.get('title')}" — اختر المنفّذ من قائمة المهتمّين.`,
      requestId: serviceRequest.id,
    });
  }

  return { interestId: interest.id, message: 'سُجّل اهتمامك، والإمام يختار المنفّذ.' };
});

/** سحب الاهتمام قبل الاختيار. */
Parse.Cloud.define('withdrawInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = new Parse.Object('ServiceRequests');
  serviceRequest.id = requestId;

  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (!interest) E.notFound('لا يوجد اهتمام مسجّل لك بهذا الطلب.');

  interest.set('status', 'withdrawn');
  await interest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.INTEREST_WITHDRAWN,
    target: interest,
    actor: volunteer,
  });

  return { status: 'withdrawn' };
});

/**
 * اهتمامات المتطوّع المستدعي — `TaskInterests` مقفلة فلا يصلها العميل مباشرةً.
 */
Parse.Cloud.define('getMyInterests', async (request) => {
  const volunteer = requireRole(request, 'volunteer');

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .descending('createdAt')
    .include('requestId')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const serviceRequest = interest.get('requestId');
    return {
      id: interest.id,
      status: interest.get('status'),
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
      requestId: serviceRequest ? serviceRequest.id : null,
      requestTitle: serviceRequest ? serviceRequest.get('title') : null,
      requestStatus: serviceRequest ? serviceRequest.get('status') : null,
    };
  });
});

/**
 * قائمة المهتمّين بطلب — للإمام صاحب المسجد وحده.
 *
 * تُعاد المهارات والتقييم ليختار الإمام عن بيّنة. لا يُعاد رقم الهاتف: التواصل
 * يبدأ بعد التكليف عبر الإشعار، فلا داعي لكشفه لكل من سجّل اهتماماً.
 */
Parse.Cloud.define('getRequestInterests', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .include('volunteerId')
    .ascending('createdAt')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const volunteer = interest.get('volunteerId');
    return {
      interestId: interest.id,
      volunteerId: volunteer ? volunteer.id : null,
      fullName: volunteer ? volunteer.get('fullName') : null,
      skills: (volunteer && volunteer.get('skills')) || [],
      completedJobs: (volunteer && volunteer.get('completedJobs')) || 0,
      avgRating: volunteer ? volunteer.get('avgRating') : null,
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
    };
  });
});

/** تعيين منفّذ: متطوع أو شركة. الإمام هو من يعيّن. */
Parse.Cloud.define('assignWorker', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, workerId } = request.params;
  if (!requestId || !workerId) E.invalid('معرّف الطلب ومعرّف المنفّذ مطلوبان.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // التحقق من الملكية يدوياً — query.get يتجاهل قيود equalTo
  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const allowed = [STATUS.FUNDED, STATUS.OPEN_FOR_VOLUNTEERS];
  if (!allowed.includes(serviceRequest.get('status'))) {
    E.invalid('لا يمكن التعيين في هذه المرحلة — تأكد من تمويل الطلب أولاً.');
  }

  const worker = await new Parse.Query(Parse.User).get(workerId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  const role = worker.get('role');
  if (role === 'volunteer') {
    if (serviceRequest.get('estimatedCost') > 0) E.invalid('الطلبات المموّلة تُسند إلى شركة معتمدة.');
    serviceRequest.set('assignedVolunteerId', worker);
  } else if (role === 'contractor') {
    if (!worker.get('isVerifiedContractor')) E.forbidden('هذه الشركة غير معتمدة بعد.');
    serviceRequest.set('assignedContractorId', worker);
  } else {
    E.invalid('المستخدم ليس متطوعاً ولا شركة خدمات.');
  }

  const previousStatus = serviceRequest.get('status');
  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORKER_ASSIGNED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: previousStatus,
    toStatus: STATUS.ASSIGNED,
  });

  await closeInterests(serviceRequest);

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/**
 * إقفال الاهتمامات المعلّقة بعد اختيار المنفّذ.
 * تركُها `active` يُبقي القائمة تعرض من لم يُختَر كأنه ما زال بالانتظار.
 */
async function closeInterests(serviceRequest) {
  const open = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .limit(100)
    .find({ useMasterKey: true });

  for (const interest of open) interest.set('status', 'closed');
  if (open.length > 0) await Parse.Object.saveAll(open, { useMasterKey: true });
}

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORK_STARTED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: STATUS.IN_PROGRESS,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبلّغ بانتهاء العمل — لا يُقفل الطلب، بل ينتظر معاينة الإمام. */
Parse.Cloud.define('markWorkDone', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const { requestId, notes, photoUrls } = request.params;
  const serviceRequest = await loadAssignedRequest(requestId, user);

  if (serviceRequest.get('status') !== STATUS.IN_PROGRESS) E.invalid('الطلب ليس قيد التنفيذ.');

  serviceRequest.set('status', STATUS.PENDING_APPROVAL);
  serviceRequest.set('workerNotes', String(notes || '').slice(0, 1000));
  serviceRequest.set('completionPhotos', Array.isArray(photoUrls) ? photoUrls.slice(0, 6) : []);
  serviceRequest.set('workDoneAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.WORK_DONE,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.IN_PROGRESS,
    toStatus: STATUS.PENDING_APPROVAL,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `تم إنجاز "${serviceRequest.get('title')}" — بانتظار معاينتك واعتمادك.`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

/** الإمام يعاين ويعتمد. هنا فقط يُقفل الطلب وتُسجّل ساعات التطوّع. */
Parse.Cloud.define('completeService', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, rating, volunteerHours } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if (serviceRequest.get('status') !== STATUS.PENDING_APPROVAL) {
    E.invalid('الطلب ليس بانتظار الاعتماد.');
  }

  const score = Math.min(Math.max(Number(rating) || 5, 1), 5);
  serviceRequest.set('status', STATUS.COMPLETED);
  serviceRequest.set('imamRating', score);
  serviceRequest.set('imamApprovalDate', new Date());
  serviceRequest.set('volunteerHours', Math.min(Number(volunteerHours) || 0, 24));
  await serviceRequest.save(null, { useMasterKey: true });

  await recordWorkerRating(serviceRequest, score);

  await audit.record({
    action: audit.ACTIONS.REQUEST_COMPLETED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: imam,
    fromStatus: STATUS.PENDING_APPROVAL,
    toStatus: STATUS.COMPLETED,
  });

  // TODO: صرف المستحقات للشركة يتم عبر دالة payout منفصلة بعد الاعتماد (functions/donations.js)
  // TODO: تسجيل ساعات التطوّع في منصة "أيادي" — يحتاج اتفاقية وAPI key رسمي.

  return { message: 'تم اعتماد العمل، بارك الله فيكم.', status: STATUS.COMPLETED };
});

/** إلغاء الطلب — الإمام فقط، وقبل بدء التنفيذ، وبشرط عدم وجود تمويل مُحصّل. */
Parse.Cloud.define('cancelServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(request.params.requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);
  const status = serviceRequest.get('status');

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(status)) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  // العمل بدأ فعلاً: إلغاؤه يُضيّع جهد المنفّذ ويُسقط حقّه في المعاينة
  if ([STATUS.IN_PROGRESS, STATUS.PENDING_APPROVAL].includes(status)) {
    E.forbidden('بدأ التنفيذ — عاين العمل واعتمده، أو تواصل مع المنفّذ.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CANCELLED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: status,
    toStatus: STATUS.CANCELLED,
  });

  // المنفّذ المكلَّف قد يكون في طريقه إلى المسجد — يجب أن يعلم
  const worker = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (worker) {
    await pushToUsers(worker, {
      alert: `أُلغي طلب "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: STATUS.CANCELLED };
});

/**
 * تحديث سجل المنفّذ عند اعتماد العمل.
 *
 * `completedJobs` و`avgRating` كانا معرّفين في المخطط ولا يُكتبان أبداً، فتقييم
 * المنفّذين معطّل فعلياً. المتوسط يُحسب تراكمياً من العدد السابق فلا نحتفظ بكل
 * التقييمات. قراءة‑ثم‑كتابة هنا مقبولة: اعتمادان متزامنان للمنفّذ نفسه نادران
 * وأثرهما تقييم منحرف قليلاً لا مال ضائع — بخلاف `walletBalance`.
 */
async function recordWorkerRating(serviceRequest, score) {
  const pointer = serviceRequest.get('assignedContractorId')
    || serviceRequest.get('assignedVolunteerId');
  if (!pointer) return;

  const worker = await fetchPointer(pointer, '_User');
  const done = worker.get('completedJobs') || 0;
  const average = worker.get('avgRating');

  worker.set('avgRating', average == null ? score : ((average * done) + score) / (done + 1));
  worker.increment('completedJobs', 1);
  await worker.save(null, { useMasterKey: true });
}

async function loadAssignedRequest(requestId, user) {
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const volunteer = serviceRequest.get('assignedVolunteerId');
  const contractor = serviceRequest.get('assignedContractorId');
  const assignedId = (volunteer && volunteer.id) || (contractor && contractor.id);
  if (assignedId !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');
  return serviceRequest;
}

module.exports = { STATUS };
```

#### `cloud/functions/donations.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole, fetchPointer } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const payments = require('../lib/payments');
const { STATUS } = require('./requests');
const audit = require('../lib/audit');
const crypto = require('crypto');

/**
 * ⚠️ ثلاثة أخطاء جوهرية في النسخة الأصلية من fundRequest تم إصلاحها هنا:
 *
 * 1) كانت تُحدّث الرصيد فور استدعاء الدالة — أي أن أي مستخدم يستطيع
 *    "التبرع" بمليون ريال دون أن يدفع فلساً. الآن: المال يُقيَّد فقط بعد
 *    تأكيد البوابة عبر confirmDonation.
 * 2) كانت تعتبر الطلب مموّلاً بالكامل مهما كان المبلغ. الآن: تمويل جزئي
 *    تراكمي عبر fundedAmount، والحالة تتغيّر عند بلوغ التكلفة التقديرية.
 * 3) mosque كان Pointer غير مُحمّل، فـ get('walletBalance') يعيد undefined
 *    والنتيجة NaN في الرصيد. الآن نجلب الكائن قبل التعديل، ونستخدم
 *    increment() الذرّية بدل قراءة-ثم-كتابة (تفادي حالات التسابق).
 */

const MIN_DONATION_OMR = 1;
const MAX_DONATION_OMR = 1000;

// مهلة حجز نيّة التبرّع. بعدها تُعتبر الجلسة مهجورة ويُفرَج عن مبلغها
// ليتبرّع به غيره — وإلا عطّل متبرّعٌ لم يُكمل الدفع تمويلَ الطلب إلى الأبد.
const PENDING_TTL_MINUTES = 30;

/**
 * مجموع نيّات التبرّع المعلّقة الحيّة لهذا الطلب.
 *
 * `fundedAmount` لا يعدّ إلا المبالغ المُقيَّدة، فلو اعتمدنا عليه وحده لرأى كل
 * متبرّع المتبقي كاملاً متاحاً: خمسة متبرّعين يبدأون معاً بـ500 ريال لطلب
 * تكلفته 500، ويدفعون جميعاً، فتُقبض 2500 ريال بلا مسار استرداد.
 */
async function reservedAmount(serviceRequest) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const pending = await new Parse.Query('Transactions')
    .equalTo('requestId', serviceRequest)
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .greaterThan('createdAt', cutoff)
    .limit(1000)
    .find({ useMasterKey: true });

  return pending.reduce((sum, t) => sum + (Number(t.get('amount')) || 0), 0);
}

/** الخطوة 1: إنشاء نيّة تبرّع + جلسة دفع. لا يتحرك أي رصيد هنا. */
Parse.Cloud.define('initiateDonation', async (request) => {
  const donor = requireRole(request, 'donor', 'imam', 'volunteer', 'contractor', 'admin');
  const { requestId, amount, successUrl, cancelUrl } = request.params;

  const value = Number(amount);
  if (!Number.isFinite(value) || value < MIN_DONATION_OMR || value > MAX_DONATION_OMR) {
    E.invalid(`المبلغ يجب أن يكون بين ${MIN_DONATION_OMR} و ${MAX_DONATION_OMR} ريال.`);
  }

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.PENDING_FUNDING) {
    E.invalid('هذا الطلب لا يقبل التمويل حالياً.');
  }

  const funded = serviceRequest.get('fundedAmount') || 0;
  const reserved = await reservedAmount(serviceRequest);
  const remaining = serviceRequest.get('estimatedCost') - funded - reserved;

  if (remaining <= 0) {
    E.invalid(`الطلب محجوز بالكامل حالياً — أعد المحاولة بعد ${PENDING_TTL_MINUTES} دقيقة.`);
  }
  if (value > remaining) E.invalid(`المتاح للتبرّع الآن ${remaining} ريال فقط.`);

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  const Transaction = Parse.Object.extend('Transactions');
  const transaction = new Transaction();
  transaction.set('donorId', donor);
  transaction.set('mosqueId', mosque);
  transaction.set('requestId', serviceRequest);
  transaction.set('amount', value);
  transaction.set('type', 'donation');
  transaction.set('status', 'pending');
  await transaction.save(null, { useMasterKey: true });

  const session = await payments.createCheckoutSession({
    amountOmr: value,
    clientReferenceId: transaction.id, // مفتاح المطابقة والمنع المزدوج
    description: `تبرع: ${serviceRequest.get('title')} — ${mosque.get('name')}`,
    successUrl: successUrl || process.env.PAYMENT_SUCCESS_URL,
    cancelUrl: cancelUrl || process.env.PAYMENT_CANCEL_URL,
  });

  transaction.set('paymentSessionId', session.sessionId);
  await transaction.save(null, { useMasterKey: true });

  return { transactionId: transaction.id, redirectUrl: session.redirectUrl };
});

/**
 * الخطوة 2: التأكيد. تُستدعى من webhook البوابة أو عند عودة المستخدم.
 * تعتمد حصراً على استعلام البوابة، لا على ما يرسله العميل.
 * idempotent: استدعاؤها مرتين لا يضاعف الرصيد.
 */
Parse.Cloud.define('confirmDonation', async (request) => {
  const caller = request.master ? null : requireUser(request);
  const { transactionId } = request.params;

  const transaction = await new Parse.Query('Transactions')
    .get(transactionId, { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  // صاحب المعاملة وحده — أو استدعاء بـ Master Key من webhook البوابة.
  // بدون هذا الشرط يستطيع أي مستخدم مصادَق أن يستدعيها على معاملة غيره.
  if (caller) {
    const owner = transaction.get('donorId');
    if (!owner || owner.id !== caller.id) E.forbidden('هذه المعاملة ليست لك.');
  }

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق تأكيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') E.invalid('حالة المعاملة لا تسمح بالتأكيد.');

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));
  if (!verification.paid) {
    // الجلسة ما تزال مفتوحة: تبقى المعاملة `pending` ليصحّ التأكيد بعد الدفع.
    // تعليمها `failed` هنا يُسقطها نهائياً من مسار التأكيد ويضيّع مبلغ المتبرع.
    if (!verification.terminal) {
      return { status: 'pending', message: 'لم يكتمل الدفع بعد — أعد المحاولة بعد إتمامه.' };
    }
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed', message: 'أُلغيت عملية الدفع أو انتهت صلاحية الجلسة.' };
  }

  // تطابق المبلغ — حماية من التلاعب في صفحة الدفع
  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل — راجع الإدارة.');
  }

  return captureDonation(transaction, verification);
});

/**
 * قيد تبرّع مؤكَّد الدفع. مشتركة بين `confirmDonation` والمهمة الدورية، فلا
 * يوجد مساران يُقيّدان المال بمنطقين مختلفين.
 */
async function captureDonation(transaction, verification) {
  transaction.set('status', 'captured');
  transaction.set('paymentGatewayRef', verification.reference);
  transaction.set('capturedAt', new Date());
  await transaction.save(null, { useMasterKey: true });

  const amount = transaction.get('amount');
  const mosque = await fetchPointer(transaction.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(transaction.get('requestId'), 'ServiceRequests');

  // increment ذرّي على مستوى قاعدة البيانات — آمن مع التبرعات المتزامنة
  mosque.increment('walletBalance', amount);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_CAPTURED,
    target: transaction,
    mosque,
    actor: transaction.get('donorId'),
    amount,
  });

  if (serviceRequest.get('fundedAmount') >= serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.FUNDED);
    serviceRequest.set('isFundedByDonors', true);
    serviceRequest.set('fundedAt', new Date());
    await serviceRequest.save(null, { useMasterKey: true });

    const imam = mosque.get('imamId');
    if (imam) {
      await pushToUsers(imam, {
        alert: `اكتمل تمويل "${serviceRequest.get('title')}" — يمكنك تعيين المنفّذ الآن.`,
        requestId: serviceRequest.id,
      });
    }
  }

  return { status: 'captured', fundedAmount: serviceRequest.get('fundedAmount') };
}

/**
 * مقارنة السرّ بزمن ثابت — المقارنة بـ`===` تُسرّب طول البادئة المطابقة.
 */
function secretMatches(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * نقطة نهاية البوابة.
 *
 * تُستدعى من ثواني لا من مستخدم، فلا جلسة معها — التوثيق بسرّ مشترك يُضبط في
 * `PAYMENT_WEBHOOK_SECRET` ويُسجَّل في لوحة البوابة.
 *
 * **جسم الطلب لا يُصدَّق إطلاقاً.** كل ما يُؤخذ منه هو معرّف المعاملة، ثم تُسأل
 * البوابة عن حالتها الحقيقية. من يعرف السرّ يستطيع أن يطلب إعادة الفحص، لا أن
 * يُقرّر أن الدفع تمّ.
 *
 * أفضلُ من المهمة الدورية لأن القيد يتمّ لحظة الدفع لا بعد ساعة، والمهمة تبقى
 * شبكة أمان لما يضيع من الطلبات.
 */
Parse.Cloud.define('paymentWebhook', async (request) => {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!expected) E.forbidden('نقطة نهاية البوابة غير مهيأة.');
  if (!secretMatches(request.params.secret, expected)) E.forbidden('توثيق غير صالح.');

  // ثواني تُعيد معرّف المعاملة في client_reference_id كما أُرسل عند إنشاء الجلسة
  const transactionId = request.params.clientReferenceId || request.params.client_reference_id;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const transaction = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق قيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') {
    return { status: transaction.get('status'), message: 'حالة المعاملة لا تسمح بالقيد.' };
  }

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));

  if (!verification.paid) {
    if (!verification.terminal) return { status: 'pending' };
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed' };
  }

  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل.');
  }

  return captureDonation(transaction, verification);
});

/**
 * صرف المستحقات للشركة بعد اعتماد الإمام. مشرف فقط.
 * التحويل الفعلي يتم خارج النظام (حوالة بنكية) — هنا نسجّل القيد فقط.
 */
Parse.Cloud.define('payoutContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { requestId, amount, bankRef } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .include('mosqueId').include('assignedContractorId')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.COMPLETED) E.invalid('لم يُعتمد العمل بعد.');
  if (serviceRequest.get('isPaidOut')) E.duplicate('تم الصرف لهذا الطلب مسبقاً.');

  const mosque = serviceRequest.get('mosqueId');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) E.invalid('المبلغ غير صحيح.');

  // الخصم أولاً بعملية ذرّية ثم التحقق. فحصُ الرصيد قبل الخصم لا يمنع صرفين
  // متزامنين من اجتيازه معاً، و`increment` ذرّي لكن القراءة التي تسبقه ليست كذلك.
  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', value); // تعويض: إعادة ما خُصم
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي.');
  }

  // يُعلَّم الطلب مصروفاً فور تأمين المبلغ، قبل قيد المعاملة، تضييقاً لنافذة
  // الصرف المزدوج. الإغلاق التام يحتاج قيداً على مستوى قاعدة البيانات.
  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  const Transaction = Parse.Object.extend('Transactions');
  const payout = new Transaction();
  payout.set('mosqueId', mosque);
  payout.set('requestId', serviceRequest);
  payout.set('payeeId', serviceRequest.get('assignedContractorId'));
  payout.set('amount', value);
  payout.set('type', 'payout');
  payout.set('status', 'captured');
  payout.set('paymentGatewayRef', String(bankRef || ''));
  payout.set('approvedBy', admin);
  await payout.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.PAYOUT_RECORDED,
    target: payout,
    mosque,
    actor: admin,
    amount: value,
  });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
});

/**
 * استرداد تبرّع مُقيَّد — مشرف فقط.
 *
 * كان المسار مفقوداً كلياً: طلبٌ يُلغى بعد التمويل، أو تمويلٌ زائد أفلت من
 * الحجز، كلاهما بلا مخرج إلا تعديل قاعدة البيانات يدوياً. التحويل الفعلي يتم
 * خارج النظام كما في الصرف — هنا يُسجَّل القيد ويُعاد الطلب إلى حالة التمويل.
 */
Parse.Cloud.define('refundDonation', async (request) => {
  const admin = requireRole(request, 'admin');
  const { transactionId, reason } = request.params;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const original = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (original.get('type') !== 'donation') E.invalid('الاسترداد للتبرعات وحدها.');
  if (original.get('status') === 'refunded') E.duplicate('سبق استرداد هذه المعاملة.');
  if (original.get('status') !== 'captured') E.invalid('لا يُسترد إلا مبلغ مُقيَّد.');

  const amount = original.get('amount');
  const mosque = await fetchPointer(original.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(original.get('requestId'), 'ServiceRequests');

  if (serviceRequest.get('isPaidOut')) {
    E.forbidden('صُرفت مستحقات هذا الطلب — الاسترداد بعده تسوية محاسبية يدوية.');
  }

  // الخصم أولاً ثم التحقق، كما في الصرف: الرصيد قد يكون أُنفق على طلب آخر
  mosque.increment('walletBalance', -amount);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', amount); // تعويض
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي للاسترداد — رُوجع في طلبات أخرى.');
  }

  original.set('status', 'refunded');
  await original.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', -amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  // الطلب لم يعد مموّلاً بالكامل، فيعود لاستقبال التمويل
  if (serviceRequest.get('status') === STATUS.FUNDED
      && serviceRequest.get('fundedAmount') < serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.PENDING_FUNDING);
    serviceRequest.set('isFundedByDonors', false);
    await serviceRequest.save(null, { useMasterKey: true });
  }

  const Transaction = Parse.Object.extend('Transactions');
  const entry = new Transaction();
  entry.set('mosqueId', mosque);
  entry.set('requestId', serviceRequest);
  entry.set('payeeId', original.get('donorId'));
  entry.set('amount', amount);
  entry.set('type', 'refund');
  entry.set('status', 'captured');
  entry.set('paymentGatewayRef', String(reason || ''));
  entry.set('approvedBy', admin);
  await entry.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_REFUNDED,
    target: entry,
    mosque,
    actor: admin,
    amount,
  });

  return { message: 'سُجّل الاسترداد.', transactionId: entry.id, fundedAmount: serviceRequest.get('fundedAmount') };
});

/** سجل شفاف لكل مسجد — متاح للجميع، بلا بيانات شخصية للمتبرعين. */
Parse.Cloud.define('getMosqueLedger', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const transactions = await new Parse.Query('Transactions')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'captured')
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return transactions.map((t) => ({
    id: t.id,
    amount: t.get('amount'),
    type: t.get('type'),
    createdAt: t.get('createdAt'),
    requestId: t.get('requestId') ? t.get('requestId').id : null,
  }));
});

/**
 * مراجعة المعاملات المعلّقة.
 *
 * `confirmDonation` تُستدعى عند عودة المستخدم من صفحة الدفع، فإن أغلق التطبيق
 * بعد الدفع مباشرة بقيت معاملته `pending` ومالُه غير مقيَّد. تُجدوَل هذه المهمة
 * من لوحة Back4app (Server Settings → Background Jobs) كل ساعة.
 *
 * تسأل البوابة عن كل معاملة معلّقة تجاوزت مهلة الحجز:
 *   دُفعت    → تُقيَّد عبر `captureDonation` نفسها التي تستعملها الدالة
 *   انتهت    → `failed`
 *   مفتوحة   → تُترك، إلا إذا تجاوزت المهلة القصوى فتصير `expired`
 */
const PENDING_MAX_AGE_HOURS = 24;

Parse.Cloud.job('reviewPendingDonations', async (request) => {
  const { message } = request;

  if (!payments.isConfigured()) {
    message('بوابة الدفع غير مهيأة — لا شيء لمراجعته.');
    return 'skipped';
  }

  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const stale = await new Parse.Query('Transactions')
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .lessThan('createdAt', cutoff)
    .limit(100)
    .find({ useMasterKey: true });

  const counts = { captured: 0, failed: 0, expired: 0, open: 0, errors: 0 };
  const expiryLimit = new Date(Date.now() - PENDING_MAX_AGE_HOURS * 3600 * 1000);

  for (const transaction of stale) {
    try {
      const verification = await payments.verifySession(transaction.get('paymentSessionId'));

      if (verification.paid) {
        // نفس فحص المطابقة الذي في confirmDonation — لا يُقيَّد مبلغ مخالف
        if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
          transaction.set('status', 'mismatch');
          await transaction.save(null, { useMasterKey: true });
          counts.errors += 1;
          continue;
        }
        await captureDonation(transaction, verification);
        counts.captured += 1;
      } else if (verification.terminal) {
        transaction.set('status', 'failed');
        await transaction.save(null, { useMasterKey: true });
        counts.failed += 1;
      } else if (transaction.get('createdAt') < expiryLimit) {
        transaction.set('status', 'expired');
        await transaction.save(null, { useMasterKey: true });
        await audit.record({
          action: audit.ACTIONS.DONATION_EXPIRED,
          target: transaction,
          mosque: transaction.get('mosqueId'),
          amount: transaction.get('amount'),
        });
        counts.expired += 1;
      } else {
        counts.open += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error('[reviewPendingDonations]', transaction.id, error && error.message);
    }
  }

  const summary = `فُحصت ${stale.length}: قُيّدت ${counts.captured}، فشلت ${counts.failed}، `
    + `انتهت ${counts.expired}، ما تزال مفتوحة ${counts.open}، أخطاء ${counts.errors}`;
  message(summary);
  return summary;
});

/**
 * سجل التدقيق لمسجد — من فعل ماذا ومتى.
 * `getMosqueLedger` يُظهر المال، وهذا يُظهر القرارات. هوية الفاعل لا تُعاد،
 * دوره فقط: الغرض تتبّع المسار لا كشف الأشخاص.
 */
Parse.Cloud.define('getMosqueAuditTrail', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const entries = await new Parse.Query('AuditLog')
    .equalTo('mosqueId', mosque)
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return entries.map((entry) => ({
    action: entry.get('action'),
    targetClass: entry.get('targetClass'),
    targetId: entry.get('targetId'),
    fromStatus: entry.get('fromStatus'),
    toStatus: entry.get('toStatus'),
    actorRole: entry.get('actorRole'),
    amount: entry.get('amount'),
    createdAt: entry.get('createdAt'),
  }));
});
```

#### `cloud/functions/users.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');
const { pushToUsers } = require('../lib/push');
const audit = require('../lib/audit');

/**
 * شؤون الحسابات: اعتماد الشركات، والملف الشخصي.
 *
 * اعتماد الشركة كان بلا مسار أصلاً: جدول الأدوار يقول إن المشرف «يعتمد
 * الشركات»، و`beforeSave` يحظر تعديل `isVerifiedContractor` إلا بـ Master Key —
 * فلم يكن أمام المشرف إلا تعديل السجل يدوياً من لوحة التحكم، بلا أثر في السجل.
 */

/** الشركات المنتظرة اعتماداً — مشرف فقط. */
Parse.Cloud.define('listPendingContractors', async (request) => {
  requireRole(request, 'admin');

  const contractors = await new Parse.Query(Parse.User)
    .equalTo('role', 'contractor')
    .equalTo('isVerifiedContractor', false)
    .ascending('createdAt')
    .limit(100)
    .find({ useMasterKey: true });

  return contractors.map((contractor) => ({
    id: contractor.id,
    fullName: contractor.get('fullName'),
    companyName: contractor.get('companyName'),
    crNumber: contractor.get('crNumber'), // السجل التجاري — أساس الاعتماد
    phone: contractor.get('phone'),
    createdAt: contractor.get('createdAt'),
  }));
});

/** اعتماد شركة أو سحب اعتمادها — مشرف فقط. */
Parse.Cloud.define('reviewContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { contractorId, approve } = request.params;
  if (!contractorId) E.invalid('معرّف الشركة مطلوب.');

  const contractor = await new Parse.Query(Parse.User)
    .get(contractorId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  if (contractor.get('role') !== 'contractor') E.invalid('هذا المستخدم ليس شركة خدمات.');

  const verified = Boolean(approve);
  if (verified && !contractor.get('crNumber')) {
    E.invalid('لا يُعتمد مزوّد بلا رقم سجل تجاري.');
  }

  contractor.set('isVerifiedContractor', verified);
  await contractor.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.CONTRACTOR_REVIEWED,
    target: contractor,
    actor: admin,
    toStatus: verified ? 'verified' : 'unverified',
  });

  await pushToUsers(contractor, {
    alert: verified ? 'تم اعتماد شركتكم في منصة مسجدي.' : 'أُوقف اعتماد شركتكم مؤقتاً.',
  });

  return { isVerifiedContractor: verified };
});

/**
 * ضبط المسجد المفضّل — نقطة الدخول الافتراضية في التطبيق.
 * تمرّ بدالة سحابة لا بكتابة مباشرة، للتحقق من وجود المسجد قبل ربط المؤشّر.
 */
Parse.Cloud.define('setFavoriteMosque', async (request) => {
  const user = requireUser(request);
  const { mosqueId } = request.params;

  if (!mosqueId) {
    user.unset('favoriteMosqueId');
    await user.save(null, { useMasterKey: true });
    return { favoriteMosqueId: null };
  }

  const mosque = await new Parse.Query('Mosques')
    .get(String(mosqueId), { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  user.set('favoriteMosqueId', mosque);
  await user.save(null, { useMasterKey: true });

  return { favoriteMosqueId: mosque.id, mosqueName: mosque.get('name') };
});

/** ملف المستخدم كما يعرضه التطبيق. */
Parse.Cloud.define('getMyProfile', async (request) => {
  const user = requireUser(request);
  await user.fetch({ useMasterKey: true });

  const favorite = user.get('favoriteMosqueId');
  let favoriteName = null;
  if (favorite) {
    const loaded = await favorite.fetch({ useMasterKey: true }).catch(() => null);
    favoriteName = loaded ? loaded.get('name') : null;
  }

  return {
    id: user.id,
    role: user.get('role'),
    fullName: user.get('fullName'),
    phone: user.get('phone'),
    skills: user.get('skills') || [],
    governorate: user.get('governorate'),
    wilayat: user.get('wilayat'),
    companyName: user.get('companyName'),
    crNumber: user.get('crNumber'),
    isVerifiedContractor: Boolean(user.get('isVerifiedContractor')),
    completedJobs: user.get('completedJobs') || 0,
    avgRating: user.get('avgRating'),
    favoriteMosqueId: favorite ? favorite.id : null,
    favoriteMosqueName: favoriteName,
  };
});
```

#### `cloud/functions/maintenance.js`

```javascript
/**
 * صيانة دورية للبيانات المتراكمة.
 */

// `AuditLog` ينمو بسطر لكل تحوّل حالة وكل حركة مال، وباقة Back4app المجانية
// 250 ميغابايت تشترك فيها بيانات 18 ألف مسجد. ستة أشهر تكفي للمساءلة أمام
// المتبرّع، وما قبلها يُؤرشَف خارج المنصّة إن لزم.
const AUDIT_RETENTION_DAYS = 180;
const PRUNE_BATCH = 500;

Parse.Cloud.job('pruneAuditLog', async (request) => {
  const { params, message } = request;

  const days = Math.max(Number(params.retentionDays) || AUDIT_RETENTION_DAYS, 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  let removed = 0;
  for (;;) {
    const batch = await new Parse.Query('AuditLog')
      .lessThan('createdAt', cutoff)
      .limit(PRUNE_BATCH)
      .find({ useMasterKey: true });

    if (batch.length === 0) break;
    await Parse.Object.destroyAll(batch, { useMasterKey: true });
    removed += batch.length;

    message(`حُذف ${removed} سطراً حتى الآن…`);
    if (batch.length < PRUNE_BATCH) break;
  }

  const summary = `حُذف ${removed} سطر تدقيق أقدم من ${days} يوماً.`;
  message(summary);
  return summary;
});
```

### 6ب — النسخة المدمجة (للصق في Back4app)

مولّدة آلياً من ملفات القسم 6أ عبر `scripts/build_single_file.py`، وقد حُذفت
منها أسطر `require` و`module.exports` لتعمل كملف واحد. **لا تُفكّك هذه النسخة**
— قطعها بلا استيراد ولا تصدير ولن تُحمَّل كوحدات منفصلة؛ استخدم القسم 6أ.

الصقها في `main.js` داخل Back4app → Cloud Code → Deploy.

```javascript
/**
 * مسجدي (Masjidi) — Cloud Code كاملاً في ملف واحد
 * =================================================
 * الصق هذا الملف في: Back4app → Server Settings → Cloud Code → main.js → Deploy
 *
 * مولّد آلياً من مجلد cloud/ عبر scripts/build_single_file.py
 * للتطوير طويل الأمد استخدم النسخة المجزّأة — التعديل هنا يُفقد عند إعادة التوليد.
 */


// ======================================================================
// الأخطاء الموحّدة   [lib/errors.js]
// ======================================================================

/**
 * أخطاء موحّدة برسائل عربية وأكواد Parse قياسية.
 * لا تستخدم `throw new Error(...)` في دوال السحابة — العميل يفقد كود الخطأ.
 */

const CODES = {
  INVALID_SESSION: Parse.Error.INVALID_SESSION_TOKEN, // 209
  VALIDATION: Parse.Error.VALIDATION_ERROR, // 142
  NOT_FOUND: Parse.Error.OBJECT_NOT_FOUND, // 101
  FORBIDDEN: Parse.Error.OPERATION_FORBIDDEN, // 119
  DUPLICATE: Parse.Error.DUPLICATE_VALUE, // 137
};

function fail(code, messageAr) {
  throw new Parse.Error(code, messageAr);
}

const E = {
  CODES,
  fail,
  unauthenticated: () => fail(CODES.INVALID_SESSION, 'يجب تسجيل الدخول أولاً.'),
  forbidden: (m) => fail(CODES.FORBIDDEN, m || 'ليست لديك صلاحية لتنفيذ هذا الإجراء.'),
  invalid: (m) => fail(CODES.VALIDATION, m || 'البيانات المُرسلة غير صحيحة.'),
  notFound: (m) => fail(CODES.NOT_FOUND, m || 'العنصر المطلوب غير موجود.'),
  duplicate: (m) => fail(CODES.DUPLICATE, m || 'هذا العنصر مسجّل مسبقاً.'),
};


// ======================================================================
// الصلاحيات والأدوار   [lib/auth.js]
// ======================================================================

const ROLES = ['imam', 'volunteer', 'donor', 'contractor', 'admin'];

/** يتحقق من وجود جلسة صالحة ويعيد المستخدم. */
function requireUser(request) {
  const user = request.user;
  if (!user) E.unauthenticated();
  return user;
}

/**
 * يتحقق أن المستخدم يحمل أحد الأدوار المطلوبة.
 * ملاحظة أمنية: نقرأ الدور من الكائن المخزّن لا من request.params أبداً.
 */
function requireRole(request, ...roles) {
  const user = requireUser(request);
  const role = user.get('role');
  if (!roles.includes(role)) {
    E.forbidden(`هذه الخاصية متاحة لـ: ${roles.join('، ')} فقط.`);
  }
  return user;
}

/**
 * يعيد المسجد الذي يديره هذا الإمام.
 * الإمام قد يدير أكثر من مسجد، لذا نطلب mosqueId صراحةً عند وجود أكثر من واحد.
 */
async function mosqueForImam(imam, mosqueId) {
  const query = new Parse.Query('Mosques');
  query.equalTo('imamId', imam);
  query.equalTo('isClaimed', true);

  if (mosqueId) {
    query.equalTo('objectId', mosqueId);
    const mosque = await query.first({ useMasterKey: true });
    if (!mosque) E.forbidden('هذا المسجد غير مسجّل باسمك.');
    return mosque;
  }

  const mosques = await query.limit(2).find({ useMasterKey: true });
  if (mosques.length === 0) E.notFound('لا يوجد مسجد مسجّل باسمك بعد.');
  if (mosques.length > 1) E.invalid('تدير أكثر من مسجد — أرسل mosqueId مع الطلب.');
  return mosques[0];
}

/** جلب كائن مُشار إليه (Pointer) بشكل آمن — الـ Pointer الخام لا يحمل بياناته. */
async function fetchPointer(pointer, className) {
  if (!pointer) E.notFound(`${className} غير مرتبط بهذا السجل.`);
  if (pointer.get && pointer.get('createdAt') !== undefined && pointer.attributes && Object.keys(pointer.attributes).length > 0) {
    return pointer; // مُحمّل مسبقاً عبر include()
  }
  return pointer.fetch({ useMasterKey: true });
}


// ======================================================================
// الإشعارات   [lib/push.js]
// ======================================================================

/**
 * الإشعارات.
 *
 * ⚠️ خطأ شائع في الملف الأصلي: Parse.Push.send يستعلم على فئة _Installation
 * وليس على _User. لذلك `where: { role: "imam" }` لا يطابق شيئاً أبداً،
 * و `where: { objectId: { $in: [userIds] } }` يقارن معرّفات مستخدمين
 * بمعرّفات أجهزة. الصحيح: الاستعلام على حقل الـ pointer `user` داخل _Installation.
 *
 * شرط التشغيل: عند تسجيل الدخول في التطبيق يجب حفظ Installation
 * وربطه بالمستخدم:  installation.set('user', Parse.User.current())
 */

async function pushToUsers(users, payload) {
  const list = (Array.isArray(users) ? users : [users]).filter(Boolean);
  if (list.length === 0) return { sent: 0 };

  const installations = new Parse.Query(Parse.Installation);
  installations.containedIn('user', list);
  installations.limit(1000);

  try {
    await Parse.Push.send(
      {
        where: installations,
        data: { sound: 'default', ...payload },
      },
      { useMasterKey: true }
    );
  } catch (error) {
    // مقصود: الإشعار أثر جانبي لا يجوز أن يُسقط العملية التي يُبلّغ عنها
    console.error('[push] تعذّر الإرسال:', error && error.message);
    return { sent: 0, failed: true };
  }
  return { sent: list.length };
}

/** متطوعون قريبون: نطاق جغرافي أولاً، ثم المحافظة كخطة بديلة. */
async function pushToNearbyVolunteers(mosque, payload, radiusKm = 15) {
  const base = new Parse.Query(Parse.User);
  base.equalTo('role', 'volunteer');
  base.equalTo('isActive', true);

  const location = mosque.get('location');
  let volunteers = [];

  try {
    if (location) {
      const geo = new Parse.Query(Parse.User);
      geo.equalTo('role', 'volunteer');
      geo.equalTo('isActive', true);
      geo.withinKilometers('lastKnownLocation', location, radiusKm);
      geo.limit(500);
      volunteers = await geo.find({ useMasterKey: true });
    }

    if (volunteers.length === 0) {
      base.equalTo('governorate', mosque.get('governorate'));
      base.limit(500);
      volunteers = await base.find({ useMasterKey: true });
    }
  } catch (error) {
    // الاستعلام الجغرافي يفشل إن غاب فهرس `2dsphere` — وغيابه وارد: يُضاف
    // يدوياً من لوحة Back4app. لا يجوز أن يُسقط ذلك إنشاء طلب صيانة.
    console.error('[push] تعذّر جلب المتطوّعين القريبين:', error && error.message);
    return { sent: 0, failed: true };
  }

  return pushToUsers(volunteers, payload);
}


// ======================================================================
// بوابة الدفع   [lib/payments.js]
// ======================================================================

/**
 * محوّل بوابة الدفع.
 *
 * قاعدة ذهبية: لا يُضاف أي مبلغ إلى رصيد المسجد إلا بعد تأكيد البوابة.
 * التدفق الصحيح:
 *   1) initiateDonation  → إنشاء معاملة بحالة "pending" + جلسة دفع.
 *   2) المستخدم يدفع في صفحة البوابة.
 *   3) webhook أو التحقق اليدوي → confirmDonation → الحالة "captured" + تحديث الرصيد.
 *
 * البوابات المتاحة في عُمان: Thawani (الأكثر شيوعاً)، OmanNet عبر البنوك،
 * وAmwal. جميعها تتطلب سجلاً تجارياً وحساباً تاجراً.
 *
 * ⚠️ تنبيه تنظيمي مهم قبل تفعيل التبرعات:
 * جمع التبرعات للمساجد في السلطنة يخضع لوزارة الأوقاف والشؤون الدينية،
 * ويحتاج تصريح جمع تبرعات. لا تُفعّل هذا المسار في الإنتاج قبل الحصول
 * على الموافقة. يمكن إطلاق النسخة الأولى بمسار التطوّع العيني فقط
 * (estimatedCost = 0) دون أي حركة مالية — وهذا هو المسار الموصى به للـ MVP.
 */

const THAWANI_BASE = process.env.THAWANI_BASE_URL || 'https://uatcheckout.thawani.om/api/v1';
const THAWANI_SECRET = process.env.THAWANI_SECRET_KEY;
const THAWANI_PUBLISHABLE = process.env.THAWANI_PUBLISHABLE_KEY;

const BAISA_PER_OMR = 1000; // ثواني تتعامل بالبيسة (عدد صحيح)

function isConfigured() {
  return Boolean(THAWANI_SECRET && THAWANI_PUBLISHABLE);
}

/**
 * إنشاء جلسة دفع. يعيد { sessionId, redirectUrl }.
 * clientReferenceId هو مفتاح المنع المزدوج (idempotency) — نمرّر معرّف المعاملة.
 */
async function createCheckoutSession({ amountOmr, clientReferenceId, description, successUrl, cancelUrl }) {
  if (!isConfigured()) {
    throw new Parse.Error(Parse.Error.OTHER_CAUSE, 'بوابة الدفع غير مهيأة على الخادم.');
  }

  const response = await Parse.Cloud.httpRequest({
    method: 'POST',
    url: `${THAWANI_BASE}/checkout/session`,
    headers: { 'Content-Type': 'application/json', 'thawani-api-key': THAWANI_SECRET },
    body: {
      client_reference_id: clientReferenceId,
      mode: 'payment',
      products: [{ name: description, quantity: 1, unit_amount: Math.round(amountOmr * BAISA_PER_OMR) }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  });

  const session = response.data.data;
  return {
    sessionId: session.session_id,
    redirectUrl: `${THAWANI_BASE.replace('/api/v1', '')}/pay/${session.session_id}?key=${THAWANI_PUBLISHABLE}`,
  };
}

/**
 * حالات "غير مدفوع" النهائية: لا أمل في اكتمال الدفع بعدها.
 * ما عداها (unpaid مثلاً) يعني أن الجلسة ما تزال مفتوحة والمستخدم قد يدفع لاحقاً.
 * التمييز ضروري: تعليم معاملة `failed` وهي ما تزال قابلة للدفع يُسقطها من
 * شرط `pending` في confirmDonation، فيدفع المتبرع ولا يُقيَّد مبلغه أبداً.
 */
const TERMINAL_UNPAID = ['cancelled', 'canceled', 'expired', 'failed', 'refunded'];

/** التحقق من حالة الجلسة لدى البوابة — المصدر الوحيد للحقيقة. */
async function verifySession(sessionId) {
  const response = await Parse.Cloud.httpRequest({
    method: 'GET',
    url: `${THAWANI_BASE}/checkout/session/${sessionId}`,
    headers: { 'thawani-api-key': THAWANI_SECRET },
  });

  const session = response.data.data;
  const status = String(session.payment_status || '').toLowerCase();
  return {
    paid: status === 'paid',
    terminal: TERMINAL_UNPAID.includes(status),
    status,
    amountOmr: (session.total_amount || 0) / BAISA_PER_OMR,
    reference: session.invoice || session.session_id,
    raw: session,
  };
}

const payments = { isConfigured, createCheckoutSession, verifySession };


// ======================================================================
// سجل التدقيق   [lib/audit.js]
// ======================================================================

/**
 * سجل التدقيق.
 *
 * وعد المنصّة للمتبرّع هو الشفافية، و`getMosqueLedger` يُظهر المال وحده: من
 * تبرّع بكم ومتى صُرف. لا يُظهر من غيّر حالة الطلب ولا متى، فلا سبيل للإجابة
 * عن "من ألغى هذا الطلب؟" أو "متى اعتُمد العمل ومن اعتمده؟".
 *
 * قيدان في التصميم:
 *
 * 1) **القيد لا يُسقط العملية أبداً.** فشل الكتابة هنا يُسجَّل في السجلّ ويُبتلع
 *    — لا يجوز أن يفشل اعتماد عملٍ منجَز لأن سطر تدقيق لم يُكتب.
 * 2) **يُستدعى صراحةً من الدوال لا من `afterSave`.** المُشغّل يرى تغيّر الحالة
 *    لكنه لا يرى الفاعل: الحفظ يجري بـ Master Key فيصل `request.user` فارغاً.
 *
 * تنبيه على التكلفة: كل قيد كتابةٌ إضافية. باقة Back4app المجانية 25 ألف طلب
 * شهرياً، فالقيد مقصور على تحوّلات الحالة وحركات المال لا على كل حفظ.
 */

const ACTIONS = {
  REQUEST_CREATED: 'request_created',
  INTEREST_EXPRESSED: 'interest_expressed',
  INTEREST_WITHDRAWN: 'interest_withdrawn',
  WORKER_ASSIGNED: 'worker_assigned',
  WORK_STARTED: 'work_started',
  WORK_DONE: 'work_done',
  REQUEST_COMPLETED: 'request_completed',
  REQUEST_CANCELLED: 'request_cancelled',
  DONATION_CAPTURED: 'donation_captured',
  DONATION_EXPIRED: 'donation_expired',
  PAYOUT_RECORDED: 'payout_recorded',
  CLAIM_REVIEWED: 'claim_reviewed',
  CONTRACTOR_REVIEWED: 'contractor_reviewed',
  DONATION_REFUNDED: 'donation_refunded',
};

/**
 * قيد سطر تدقيق واحد.
 *
 * @param {object}  entry
 * @param {string}  entry.action      من `ACTIONS`
 * @param {object=} entry.target      الكائن المتأثّر (طلب، معاملة، …)
 * @param {object=} entry.mosque      المسجد — مفتاح عرض السجل
 * @param {object=} entry.actor       المستخدم الفاعل، أو لا شيء للنظام
 * @param {string=} entry.fromStatus
 * @param {string=} entry.toStatus
 * @param {number=} entry.amount
 */
async function record({ action, target, mosque, actor, fromStatus, toStatus, amount }) {
  try {
    const Entry = Parse.Object.extend('AuditLog');
    const entry = new Entry();

    entry.set('action', action);
    if (target) {
      entry.set('targetClass', target.className);
      entry.set('targetId', target.id);
    }
    if (mosque) entry.set('mosqueId', mosque);
    if (actor) {
      entry.set('actorId', actor);
      entry.set('actorRole', actor.get('role') || null);
    }
    if (fromStatus) entry.set('fromStatus', fromStatus);
    if (toStatus) entry.set('toStatus', toStatus);
    if (typeof amount === 'number') entry.set('amount', amount);

    await entry.save(null, { useMasterKey: true });
  } catch (error) {
    // مقصود: التدقيق لا يُسقط العملية التي يوثّقها
    console.error('[audit] تعذّر قيد السطر:', action, error && error.message);
  }
}

const audit = { record, ACTIONS };


// ======================================================================
// المُشغّلات (beforeSave / afterSave)   [triggers.js]
// ======================================================================

/** لا يُسمح للعميل بتعيين دوره بنفسه إلى admin، ولا بتعديل الحقول الحسّاسة. */
Parse.Cloud.beforeSave(Parse.User, async (request) => {
  const user = request.object;

  if (user.isNew() && !user.get('role')) user.set('role', 'donor');

  const role = user.get('role');
  if (role && !ROLES.includes(role)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'دور غير معروف.');
  }

  // الترقية إلى admin أو اعتماد الشركات يتم عبر Master Key فقط
  if (!request.master) {
    if (user.dirty('role')) {
      if (role === 'admin') {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
      }
      // الدور يُختار عند التسجيل ويُثبَّت بعده. تركُه مفتوحاً يعني أن متبرعاً
      // يصبح إماماً أو شركةً متى شاء، فلا يصلح الدور أساساً لأي تفويض لاحق.
      if (!user.isNew()) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تغيير الدور يتم من الإدارة.');
      }
    }
    // ⚠️ `dirty()` وحده لا يصلح حارساً على حقل له `defaultValue` في المخطط:
    // Parse يطبّق القيمة الافتراضية عند الإنشاء فيُعلّم الحقل مُعدَّلاً، فكان
    // هذا الشرط يرفض **كل تسجيل جديد** برسالة اعتماد الشركات. الصواب: الحساب
    // الجديد يبدأ غير معتمد دائماً، والتعديل بعد ذلك بـ Master Key وحده.
    if (user.isNew()) {
      user.set('isVerifiedContractor', false);
    } else if (user.dirty('isVerifiedContractor')) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'اعتماد الشركات يتم من الإدارة.');
    }
  }

  if (user.isNew()) user.set('isActive', true);
});

/**
 * إقفال المستخدم الجديد على نفسه.
 *
 * الـ CLP وحده لا يكفي: افتراض Parse أن يمنح المستخدم الجديد قراءة عامة، فيصبح
 * `phone` و`lastKnownLocation` (موقع المتطوع) مقروءاً لكل من يملك مفتاح العميل.
 * الـ ACL لا يُضبط في beforeSave لأن `objectId` لم يُسنَد بعد عند الإنشاء.
 * قراءة بيانات مستخدم آخر تبقى ممكنة من دوال السحابة عبر Master Key.
 */
Parse.Cloud.afterSave(Parse.User, async (request) => {
  if (request.original) return; // تحديث، لا إنشاء — وهو أيضاً ما يمنع الحلقة اللانهائية

  const user = request.object;
  const acl = user.getACL();
  if (acl && !acl.getPublicReadAccess() && !acl.getPublicWriteAccess()) return;

  const own = new Parse.ACL();
  own.setReadAccess(user.id, true);
  own.setWriteAccess(user.id, true);
  user.setACL(own);
  await user.save(null, { useMasterKey: true });
});

/** الرصيد والحالات لا تُعدّل إلا من دوال السحابة. */
Parse.Cloud.beforeSave('Mosques', async (request) => {
  const mosque = request.object;
  if (!request.master && (mosque.dirty('walletBalance') || mosque.dirty('imamId') || mosque.dirty('isClaimed'))) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'تعديل غير مسموح من التطبيق.');
  }
  if ((mosque.get('walletBalance') || 0) < 0) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'الرصيد لا يمكن أن يكون سالباً.');
  }
});

Parse.Cloud.beforeSave('ServiceRequests', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'الطلبات تُنشأ وتُحدّث عبر دوال السحابة فقط.');
  }
});

Parse.Cloud.beforeSave('Transactions', async (request) => {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'المعاملات المالية تُنشأ عبر دوال السحابة فقط.');
  }
  if (!request.object.isNew() && request.object.get('status') === 'captured' && request.object.dirty('amount')) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'لا يجوز تعديل مبلغ معاملة مُقيّدة.');
  }
});

/** عدّاد الطلبات المفتوحة للعرض السريع في الخريطة. */
Parse.Cloud.afterSave('ServiceRequests', async (request) => {
  const serviceRequest = request.object;
  const previous = request.original ? request.original.get('status') : null;
  if (previous === serviceRequest.get('status')) return;

  const mosquePointer = serviceRequest.get('mosqueId');
  if (!mosquePointer) return;

  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosquePointer)
    .containedIn('status', ['pending_funding', 'open_for_volunteers', 'funded', 'assigned', 'in_progress'])
    .count({ useMasterKey: true });

  const mosque = await mosquePointer.fetch({ useMasterKey: true });
  mosque.set('openRequestsCount', openCount);
  await mosque.save(null, { useMasterKey: true });
});


// ======================================================================
// دوال المساجد   [functions/mosques.js]
// ======================================================================

const PUBLIC_FIELDS = [
  'name', 'mosqueNumber', 'type', 'typeSlug', 'governorate', 'wilayat',
  'village', 'location', 'isClaimed', 'openRequestsCount',
];

/**
 * المساجد القريبة.
 * إصلاحات مقابل النسخة الأصلية: حد أقصى للنتائج، تحديد الحقول المُعادة،
 * سقف لنصف القطر، ولا نُعيد كائنات كاملة بصلاحيات Master.
 */
Parse.Cloud.define('getNearbyMosques', async (request) => {
  requireUser(request);
  const { lat, lng, radius = 5, limit = 50 } = request.params;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    E.invalid('الإحداثيات (lat, lng) مطلوبة كأرقام.');
  }
  const radiusKm = Math.min(Math.max(Number(radius) || 5, 0.5), 50);

  const point = new Parse.GeoPoint({ latitude: lat, longitude: lng });
  const query = new Parse.Query('Mosques');
  query.withinKilometers('location', point, radiusKm, true); // sorted = true
  query.select(...PUBLIC_FIELDS);
  query.limit(Math.min(Number(limit) || 50, 100));

  const results = await query.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
});

/**
 * تطبيع النص العربي — نظير `normalize_ar` في `scripts/clean_mosques.py`.
 *
 * البيانات مخزَّنة مطبَّعة في `nameNormalized`، وكان البحث يُرسل النص كما كتبه
 * المستخدم: فمن يكتب «الرحمة» لا يجد «الرحمه»، وهي المشكلة التي وُجد الحقل
 * لحلّها. الطرفان يجب أن يمرّا بالتطبيع نفسه، وإلا فالحقل بلا فائدة.
 */
function normalizeArabic(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '') // التشكيل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** بحث نصّي بالاسم أو القرية داخل ولاية/محافظة. */
Parse.Cloud.define('searchMosques', async (request) => {
  requireUser(request);
  const { term, governorate, wilayat, limit = 30 } = request.params;

  const cleaned = term ? normalizeArabic(term) : '';
  const cap = Math.min(Number(limit) || 30, 100);

  /** قيود المحافظة والولاية مشتركة بين المحاولتين. */
  const scoped = () => {
    const query = new Parse.Query('Mosques');
    if (governorate) query.equalTo('governorate', governorate);
    if (wilayat) query.equalTo('wilayat', wilayat);
    query.select(...PUBLIC_FIELDS);
    query.limit(cap);
    return query;
  };

  if (cleaned.length < 2) {
    const all = await scoped().find({ useMasterKey: true });
    return all.map((m) => m.toJSON());
  }

  // البادئة المثبّتة وحدها تستفيد من فهرس `nameNormalized`. `contains` يولّد
  // `$regex` غير مثبّت فيمسح المجموعة كاملة (18 ألف وثيقة) — يبقى خطة بديلة
  // لأن المستخدم قد يبحث بكلمة من وسط الاسم، لا احتمالاً أولَ.
  const byPrefix = scoped();
  byPrefix.startsWith('nameNormalized', cleaned);
  const prefixHits = await byPrefix.find({ useMasterKey: true });
  if (prefixHits.length > 0) return prefixHits.map((m) => m.toJSON());

  const bySubstring = scoped();
  bySubstring.contains('nameNormalized', cleaned);
  const results = await bySubstring.find({ useMasterKey: true });
  return results.map((m) => m.toJSON());
});

/**
 * طلب ملكية مسجد (الإمام يربط نفسه بمسجد من قاعدة بيانات الوزارة).
 * لا يُعتمد تلقائياً — يبقى معلقاً حتى موافقة المشرف، لأن ربط شخص بمسجد
 * يمنحه لاحقاً صلاحية استقبال تبرعات.
 */
Parse.Cloud.define('claimMosque', async (request) => {
  const imam = requireRole(request, 'imam');
  const { mosqueId, evidenceNote } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = await new Parse.Query('Mosques').get(mosqueId, { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  if (mosque.get('isClaimed')) E.duplicate('هذا المسجد مسجّل لإمام آخر بالفعل.');

  const existing = await new Parse.Query('MosqueClaims')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'pending')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('يوجد طلب ملكية معلّق لهذا المسجد.');

  const Claim = Parse.Object.extend('MosqueClaims');
  const claim = new Claim();
  claim.set('mosqueId', mosque);
  claim.set('imamId', imam);
  claim.set('status', 'pending');
  claim.set('evidenceNote', String(evidenceNote || '').slice(0, 500));
  await claim.save(null, { useMasterKey: true });

  return { message: 'تم استلام طلبك، سيُراجع خلال أيام عمل.', claimId: claim.id };
});

/**
 * طلبات الملكية الخاصة بالإمام المستدعي.
 * `MosqueClaims` مقفلة على Master Key، فبلا هذه الدالة لا يعرف الإمام أبداً
 * إن كان طلبه قد اعتُمد أو رُفض.
 */
Parse.Cloud.define('getMyClaims', async (request) => {
  const imam = requireRole(request, 'imam');

  const claims = await new Parse.Query('MosqueClaims')
    .equalTo('imamId', imam)
    .include('mosqueId')
    .descending('createdAt')
    .limit(20)
    .find({ useMasterKey: true });

  return claims.map((claim) => {
    const mosque = claim.get('mosqueId');
    return {
      id: claim.id,
      status: claim.get('status'),
      evidenceNote: claim.get('evidenceNote'),
      createdAt: claim.get('createdAt'),
      reviewedAt: claim.get('reviewedAt'),
      mosqueId: mosque ? mosque.id : null,
      mosqueName: mosque ? mosque.get('name') : null,
      wilayat: mosque ? mosque.get('wilayat') : null,
    };
  });
});

/** اعتماد أو رفض طلب الملكية (مشرف فقط). */
Parse.Cloud.define('reviewMosqueClaim', async (request) => {
  const admin = requireRole(request, 'admin');
  const { claimId, approve } = request.params;

  const claim = await new Parse.Query('MosqueClaims').include('mosqueId').include('imamId')
    .get(claimId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (claim.get('status') !== 'pending') E.invalid('تمت مراجعة هذا الطلب مسبقاً.');

  claim.set('status', approve ? 'approved' : 'rejected');
  claim.set('reviewedBy', admin);
  claim.set('reviewedAt', new Date());
  await claim.save(null, { useMasterKey: true });

  if (approve) {
    const mosque = claim.get('mosqueId');
    mosque.set('imamId', claim.get('imamId'));
    mosque.set('isClaimed', true);
    await mosque.save(null, { useMasterKey: true });
  }

  await audit.record({
    action: audit.ACTIONS.CLAIM_REVIEWED,
    target: claim,
    mosque: claim.get('mosqueId'),
    actor: admin,
    toStatus: claim.get('status'),
  });

  return { status: claim.get('status') };
});


// ======================================================================
// دوال طلبات الصيانة   [functions/requests.js]
// ======================================================================

/**
 * دورة حياة الطلب:
 *   pending_funding → funded → assigned → in_progress → pending_imam_approval → completed
 *   (أو) open_for_volunteers → assigned → ... (مسار التطوّع العيني، بلا مال)
 *   يمكن الإلغاء في أي مرحلة قبل التنفيذ → cancelled
 */
const STATUS = {
  PENDING_FUNDING: 'pending_funding',
  OPEN_FOR_VOLUNTEERS: 'open_for_volunteers',
  FUNDED: 'funded',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  PENDING_APPROVAL: 'pending_imam_approval',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const MAX_ESTIMATE_OMR = 5000;

Parse.Cloud.define('createServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const mosque = await mosqueForImam(imam, request.params.mosqueId);

  const { title, description, category, estimatedCost, urgency } = request.params;
  if (!title || String(title).trim().length < 3) E.invalid('العنوان مطلوب (3 أحرف فأكثر).');
  if (!description || String(description).trim().length < 10) E.invalid('الوصف مطلوب (10 أحرف فأكثر).');

  // `Number(x) || 0` كان يبتلع NaN فيحوّل مدخلاً فاسداً إلى طلب تطوّعي بصمت
  const cost = estimatedCost === undefined || estimatedCost === null ? 0 : Number(estimatedCost);
  if (!Number.isFinite(cost) || cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون رقماً بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
  }

  // منع إغراق النظام: حد أقصى للطلبات المفتوحة لكل مسجد
  const openCount = await new Parse.Query('ServiceRequests')
    .equalTo('mosqueId', mosque)
    .containedIn('status', [STATUS.PENDING_FUNDING, STATUS.OPEN_FOR_VOLUNTEERS, STATUS.FUNDED, STATUS.ASSIGNED, STATUS.IN_PROGRESS])
    .count({ useMasterKey: true });
  if (openCount >= 10) E.invalid('لديك 10 طلبات مفتوحة — أغلق بعضها قبل إضافة طلب جديد.');

  const ServiceRequest = Parse.Object.extend('ServiceRequests');
  const serviceRequest = new ServiceRequest();
  serviceRequest.set('mosqueId', mosque);
  serviceRequest.set('createdBy', imam);
  serviceRequest.set('title', String(title).trim().slice(0, 120));
  serviceRequest.set('description', String(description).trim().slice(0, 2000));
  serviceRequest.set('category', category || 'other'); // electrical | plumbing | ac | paint | cleaning | carpet | other
  serviceRequest.set('urgency', urgency || 'normal'); // low | normal | high
  serviceRequest.set('estimatedCost', cost);
  serviceRequest.set('fundedAmount', 0);
  serviceRequest.set('status', cost > 0 ? STATUS.PENDING_FUNDING : STATUS.OPEN_FOR_VOLUNTEERS);

  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CREATED,
    target: serviceRequest,
    mosque,
    actor: imam,
    toStatus: serviceRequest.get('status'),
  });

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

const MAX_INTEREST_NOTE = 300;

/**
 * المتطوّع يُسجّل اهتمامه بطلب مفتوح.
 *
 * لا يُسند الطلب ولا يُغيّر حالته: الإمام يبقى صاحب القرار عبر `assignWorker`.
 * بدون هذا المسار يرى المتطوّع الفرصة القريبة ولا يملك وسيلة للتعبير عنها
 * أصلاً — وهي أكبر فجوة في مسار التطوّع العيني، وهو المسار القابل للإطلاق.
 */
Parse.Cloud.define('expressInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId, note } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.OPEN_FOR_VOLUNTEERS) {
    E.invalid('هذا الطلب لا يستقبل المتطوّعين حالياً.');
  }

  const existing = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (existing) E.duplicate('سبق أن سجّلت اهتمامك بهذا الطلب.');

  const Interest = Parse.Object.extend('TaskInterests');
  const interest = new Interest();
  interest.set('requestId', serviceRequest);
  interest.set('volunteerId', volunteer);
  interest.set('status', 'active');
  interest.set('note', String(note || '').trim().slice(0, MAX_INTEREST_NOTE));
  await interest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.INTEREST_EXPRESSED,
    target: interest,
    mosque,
    actor: volunteer,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `متطوّع مهتمّ بـ "${serviceRequest.get('title')}" — اختر المنفّذ من قائمة المهتمّين.`,
      requestId: serviceRequest.id,
    });
  }

  return { interestId: interest.id, message: 'سُجّل اهتمامك، والإمام يختار المنفّذ.' };
});

/** سحب الاهتمام قبل الاختيار. */
Parse.Cloud.define('withdrawInterest', async (request) => {
  const volunteer = requireRole(request, 'volunteer');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = new Parse.Object('ServiceRequests');
  serviceRequest.id = requestId;

  const interest = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('volunteerId', volunteer)
    .equalTo('status', 'active')
    .first({ useMasterKey: true });
  if (!interest) E.notFound('لا يوجد اهتمام مسجّل لك بهذا الطلب.');

  interest.set('status', 'withdrawn');
  await interest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.INTEREST_WITHDRAWN,
    target: interest,
    actor: volunteer,
  });

  return { status: 'withdrawn' };
});

/**
 * اهتمامات المتطوّع المستدعي — `TaskInterests` مقفلة فلا يصلها العميل مباشرةً.
 */
Parse.Cloud.define('getMyInterests', async (request) => {
  const volunteer = requireRole(request, 'volunteer');

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('volunteerId', volunteer)
    .descending('createdAt')
    .include('requestId')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const serviceRequest = interest.get('requestId');
    return {
      id: interest.id,
      status: interest.get('status'),
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
      requestId: serviceRequest ? serviceRequest.id : null,
      requestTitle: serviceRequest ? serviceRequest.get('title') : null,
      requestStatus: serviceRequest ? serviceRequest.get('status') : null,
    };
  });
});

/**
 * قائمة المهتمّين بطلب — للإمام صاحب المسجد وحده.
 *
 * تُعاد المهارات والتقييم ليختار الإمام عن بيّنة. لا يُعاد رقم الهاتف: التواصل
 * يبدأ بعد التكليف عبر الإشعار، فلا داعي لكشفه لكل من سجّل اهتماماً.
 */
Parse.Cloud.define('getRequestInterests', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId } = request.params;
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const interests = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .include('volunteerId')
    .ascending('createdAt')
    .limit(50)
    .find({ useMasterKey: true });

  return interests.map((interest) => {
    const volunteer = interest.get('volunteerId');
    return {
      interestId: interest.id,
      volunteerId: volunteer ? volunteer.id : null,
      fullName: volunteer ? volunteer.get('fullName') : null,
      skills: (volunteer && volunteer.get('skills')) || [],
      completedJobs: (volunteer && volunteer.get('completedJobs')) || 0,
      avgRating: volunteer ? volunteer.get('avgRating') : null,
      note: interest.get('note'),
      createdAt: interest.get('createdAt'),
    };
  });
});

/** تعيين منفّذ: متطوع أو شركة. الإمام هو من يعيّن. */
Parse.Cloud.define('assignWorker', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, workerId } = request.params;
  if (!requestId || !workerId) E.invalid('معرّف الطلب ومعرّف المنفّذ مطلوبان.');

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  // التحقق من الملكية يدوياً — query.get يتجاهل قيود equalTo
  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  const allowed = [STATUS.FUNDED, STATUS.OPEN_FOR_VOLUNTEERS];
  if (!allowed.includes(serviceRequest.get('status'))) {
    E.invalid('لا يمكن التعيين في هذه المرحلة — تأكد من تمويل الطلب أولاً.');
  }

  const worker = await new Parse.Query(Parse.User).get(workerId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  const role = worker.get('role');
  if (role === 'volunteer') {
    if (serviceRequest.get('estimatedCost') > 0) E.invalid('الطلبات المموّلة تُسند إلى شركة معتمدة.');
    serviceRequest.set('assignedVolunteerId', worker);
  } else if (role === 'contractor') {
    if (!worker.get('isVerifiedContractor')) E.forbidden('هذه الشركة غير معتمدة بعد.');
    serviceRequest.set('assignedContractorId', worker);
  } else {
    E.invalid('المستخدم ليس متطوعاً ولا شركة خدمات.');
  }

  const previousStatus = serviceRequest.get('status');
  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORKER_ASSIGNED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: previousStatus,
    toStatus: STATUS.ASSIGNED,
  });

  await closeInterests(serviceRequest);

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/**
 * إقفال الاهتمامات المعلّقة بعد اختيار المنفّذ.
 * تركُها `active` يُبقي القائمة تعرض من لم يُختَر كأنه ما زال بالانتظار.
 */
async function closeInterests(serviceRequest) {
  const open = await new Parse.Query('TaskInterests')
    .equalTo('requestId', serviceRequest)
    .equalTo('status', 'active')
    .limit(100)
    .find({ useMasterKey: true });

  for (const interest of open) interest.set('status', 'closed');
  if (open.length > 0) await Parse.Object.saveAll(open, { useMasterKey: true });
}

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.WORK_STARTED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: user,
    fromStatus: STATUS.ASSIGNED,
    toStatus: STATUS.IN_PROGRESS,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبلّغ بانتهاء العمل — لا يُقفل الطلب، بل ينتظر معاينة الإمام. */
Parse.Cloud.define('markWorkDone', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const { requestId, notes, photoUrls } = request.params;
  const serviceRequest = await loadAssignedRequest(requestId, user);

  if (serviceRequest.get('status') !== STATUS.IN_PROGRESS) E.invalid('الطلب ليس قيد التنفيذ.');

  serviceRequest.set('status', STATUS.PENDING_APPROVAL);
  serviceRequest.set('workerNotes', String(notes || '').slice(0, 1000));
  serviceRequest.set('completionPhotos', Array.isArray(photoUrls) ? photoUrls.slice(0, 6) : []);
  serviceRequest.set('workDoneAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  await audit.record({
    action: audit.ACTIONS.WORK_DONE,
    target: serviceRequest,
    mosque,
    actor: user,
    fromStatus: STATUS.IN_PROGRESS,
    toStatus: STATUS.PENDING_APPROVAL,
  });

  const imam = mosque.get('imamId');
  if (imam) {
    await pushToUsers(imam, {
      alert: `تم إنجاز "${serviceRequest.get('title')}" — بانتظار معاينتك واعتمادك.`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
});

/** الإمام يعاين ويعتمد. هنا فقط يُقفل الطلب وتُسجّل ساعات التطوّع. */
Parse.Cloud.define('completeService', async (request) => {
  const imam = requireRole(request, 'imam');
  const { requestId, rating, volunteerHours } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if (serviceRequest.get('status') !== STATUS.PENDING_APPROVAL) {
    E.invalid('الطلب ليس بانتظار الاعتماد.');
  }

  const score = Math.min(Math.max(Number(rating) || 5, 1), 5);
  serviceRequest.set('status', STATUS.COMPLETED);
  serviceRequest.set('imamRating', score);
  serviceRequest.set('imamApprovalDate', new Date());
  serviceRequest.set('volunteerHours', Math.min(Number(volunteerHours) || 0, 24));
  await serviceRequest.save(null, { useMasterKey: true });

  await recordWorkerRating(serviceRequest, score);

  await audit.record({
    action: audit.ACTIONS.REQUEST_COMPLETED,
    target: serviceRequest,
    mosque: serviceRequest.get('mosqueId'),
    actor: imam,
    fromStatus: STATUS.PENDING_APPROVAL,
    toStatus: STATUS.COMPLETED,
  });

  // TODO: صرف المستحقات للشركة يتم عبر دالة payout منفصلة بعد الاعتماد (functions/donations.js)
  // TODO: تسجيل ساعات التطوّع في منصة "أيادي" — يحتاج اتفاقية وAPI key رسمي.

  return { message: 'تم اعتماد العمل، بارك الله فيكم.', status: STATUS.COMPLETED };
});

/** إلغاء الطلب — الإمام فقط، وقبل بدء التنفيذ، وبشرط عدم وجود تمويل مُحصّل. */
Parse.Cloud.define('cancelServiceRequest', async (request) => {
  const imam = requireRole(request, 'imam');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(request.params.requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const mosque = await mosqueForImam(imam, serviceRequest.get('mosqueId').id);
  const status = serviceRequest.get('status');

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(status)) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  // العمل بدأ فعلاً: إلغاؤه يُضيّع جهد المنفّذ ويُسقط حقّه في المعاينة
  if ([STATUS.IN_PROGRESS, STATUS.PENDING_APPROVAL].includes(status)) {
    E.forbidden('بدأ التنفيذ — عاين العمل واعتمده، أو تواصل مع المنفّذ.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.REQUEST_CANCELLED,
    target: serviceRequest,
    mosque,
    actor: imam,
    fromStatus: status,
    toStatus: STATUS.CANCELLED,
  });

  // المنفّذ المكلَّف قد يكون في طريقه إلى المسجد — يجب أن يعلم
  const worker = serviceRequest.get('assignedVolunteerId')
    || serviceRequest.get('assignedContractorId');
  if (worker) {
    await pushToUsers(worker, {
      alert: `أُلغي طلب "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
      requestId: serviceRequest.id,
    });
  }

  return { status: STATUS.CANCELLED };
});

/**
 * تحديث سجل المنفّذ عند اعتماد العمل.
 *
 * `completedJobs` و`avgRating` كانا معرّفين في المخطط ولا يُكتبان أبداً، فتقييم
 * المنفّذين معطّل فعلياً. المتوسط يُحسب تراكمياً من العدد السابق فلا نحتفظ بكل
 * التقييمات. قراءة‑ثم‑كتابة هنا مقبولة: اعتمادان متزامنان للمنفّذ نفسه نادران
 * وأثرهما تقييم منحرف قليلاً لا مال ضائع — بخلاف `walletBalance`.
 */
async function recordWorkerRating(serviceRequest, score) {
  const pointer = serviceRequest.get('assignedContractorId')
    || serviceRequest.get('assignedVolunteerId');
  if (!pointer) return;

  const worker = await fetchPointer(pointer, '_User');
  const done = worker.get('completedJobs') || 0;
  const average = worker.get('avgRating');

  worker.set('avgRating', average == null ? score : ((average * done) + score) / (done + 1));
  worker.increment('completedJobs', 1);
  await worker.save(null, { useMasterKey: true });
}

async function loadAssignedRequest(requestId, user) {
  if (!requestId) E.invalid('معرّف الطلب مطلوب.');
  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  const volunteer = serviceRequest.get('assignedVolunteerId');
  const contractor = serviceRequest.get('assignedContractorId');
  const assignedId = (volunteer && volunteer.id) || (contractor && contractor.id);
  if (assignedId !== user.id) E.forbidden('هذا الطلب غير مُسند إليك.');
  return serviceRequest;
}


// ======================================================================
// دوال التبرعات والصرف   [functions/donations.js]
// ======================================================================

const crypto = require('crypto');

/**
 * ⚠️ ثلاثة أخطاء جوهرية في النسخة الأصلية من fundRequest تم إصلاحها هنا:
 *
 * 1) كانت تُحدّث الرصيد فور استدعاء الدالة — أي أن أي مستخدم يستطيع
 *    "التبرع" بمليون ريال دون أن يدفع فلساً. الآن: المال يُقيَّد فقط بعد
 *    تأكيد البوابة عبر confirmDonation.
 * 2) كانت تعتبر الطلب مموّلاً بالكامل مهما كان المبلغ. الآن: تمويل جزئي
 *    تراكمي عبر fundedAmount، والحالة تتغيّر عند بلوغ التكلفة التقديرية.
 * 3) mosque كان Pointer غير مُحمّل، فـ get('walletBalance') يعيد undefined
 *    والنتيجة NaN في الرصيد. الآن نجلب الكائن قبل التعديل، ونستخدم
 *    increment() الذرّية بدل قراءة-ثم-كتابة (تفادي حالات التسابق).
 */

const MIN_DONATION_OMR = 1;
const MAX_DONATION_OMR = 1000;

// مهلة حجز نيّة التبرّع. بعدها تُعتبر الجلسة مهجورة ويُفرَج عن مبلغها
// ليتبرّع به غيره — وإلا عطّل متبرّعٌ لم يُكمل الدفع تمويلَ الطلب إلى الأبد.
const PENDING_TTL_MINUTES = 30;

/**
 * مجموع نيّات التبرّع المعلّقة الحيّة لهذا الطلب.
 *
 * `fundedAmount` لا يعدّ إلا المبالغ المُقيَّدة، فلو اعتمدنا عليه وحده لرأى كل
 * متبرّع المتبقي كاملاً متاحاً: خمسة متبرّعين يبدأون معاً بـ500 ريال لطلب
 * تكلفته 500، ويدفعون جميعاً، فتُقبض 2500 ريال بلا مسار استرداد.
 */
async function reservedAmount(serviceRequest) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const pending = await new Parse.Query('Transactions')
    .equalTo('requestId', serviceRequest)
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .greaterThan('createdAt', cutoff)
    .limit(1000)
    .find({ useMasterKey: true });

  return pending.reduce((sum, t) => sum + (Number(t.get('amount')) || 0), 0);
}

/** الخطوة 1: إنشاء نيّة تبرّع + جلسة دفع. لا يتحرك أي رصيد هنا. */
Parse.Cloud.define('initiateDonation', async (request) => {
  const donor = requireRole(request, 'donor', 'imam', 'volunteer', 'contractor', 'admin');
  const { requestId, amount, successUrl, cancelUrl } = request.params;

  const value = Number(amount);
  if (!Number.isFinite(value) || value < MIN_DONATION_OMR || value > MAX_DONATION_OMR) {
    E.invalid(`المبلغ يجب أن يكون بين ${MIN_DONATION_OMR} و ${MAX_DONATION_OMR} ريال.`);
  }

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.PENDING_FUNDING) {
    E.invalid('هذا الطلب لا يقبل التمويل حالياً.');
  }

  const funded = serviceRequest.get('fundedAmount') || 0;
  const reserved = await reservedAmount(serviceRequest);
  const remaining = serviceRequest.get('estimatedCost') - funded - reserved;

  if (remaining <= 0) {
    E.invalid(`الطلب محجوز بالكامل حالياً — أعد المحاولة بعد ${PENDING_TTL_MINUTES} دقيقة.`);
  }
  if (value > remaining) E.invalid(`المتاح للتبرّع الآن ${remaining} ريال فقط.`);

  const mosque = await fetchPointer(serviceRequest.get('mosqueId'), 'Mosques');

  const Transaction = Parse.Object.extend('Transactions');
  const transaction = new Transaction();
  transaction.set('donorId', donor);
  transaction.set('mosqueId', mosque);
  transaction.set('requestId', serviceRequest);
  transaction.set('amount', value);
  transaction.set('type', 'donation');
  transaction.set('status', 'pending');
  await transaction.save(null, { useMasterKey: true });

  const session = await payments.createCheckoutSession({
    amountOmr: value,
    clientReferenceId: transaction.id, // مفتاح المطابقة والمنع المزدوج
    description: `تبرع: ${serviceRequest.get('title')} — ${mosque.get('name')}`,
    successUrl: successUrl || process.env.PAYMENT_SUCCESS_URL,
    cancelUrl: cancelUrl || process.env.PAYMENT_CANCEL_URL,
  });

  transaction.set('paymentSessionId', session.sessionId);
  await transaction.save(null, { useMasterKey: true });

  return { transactionId: transaction.id, redirectUrl: session.redirectUrl };
});

/**
 * الخطوة 2: التأكيد. تُستدعى من webhook البوابة أو عند عودة المستخدم.
 * تعتمد حصراً على استعلام البوابة، لا على ما يرسله العميل.
 * idempotent: استدعاؤها مرتين لا يضاعف الرصيد.
 */
Parse.Cloud.define('confirmDonation', async (request) => {
  const caller = request.master ? null : requireUser(request);
  const { transactionId } = request.params;

  const transaction = await new Parse.Query('Transactions')
    .get(transactionId, { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  // صاحب المعاملة وحده — أو استدعاء بـ Master Key من webhook البوابة.
  // بدون هذا الشرط يستطيع أي مستخدم مصادَق أن يستدعيها على معاملة غيره.
  if (caller) {
    const owner = transaction.get('donorId');
    if (!owner || owner.id !== caller.id) E.forbidden('هذه المعاملة ليست لك.');
  }

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق تأكيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') E.invalid('حالة المعاملة لا تسمح بالتأكيد.');

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));
  if (!verification.paid) {
    // الجلسة ما تزال مفتوحة: تبقى المعاملة `pending` ليصحّ التأكيد بعد الدفع.
    // تعليمها `failed` هنا يُسقطها نهائياً من مسار التأكيد ويضيّع مبلغ المتبرع.
    if (!verification.terminal) {
      return { status: 'pending', message: 'لم يكتمل الدفع بعد — أعد المحاولة بعد إتمامه.' };
    }
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed', message: 'أُلغيت عملية الدفع أو انتهت صلاحية الجلسة.' };
  }

  // تطابق المبلغ — حماية من التلاعب في صفحة الدفع
  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل — راجع الإدارة.');
  }

  return captureDonation(transaction, verification);
});

/**
 * قيد تبرّع مؤكَّد الدفع. مشتركة بين `confirmDonation` والمهمة الدورية، فلا
 * يوجد مساران يُقيّدان المال بمنطقين مختلفين.
 */
async function captureDonation(transaction, verification) {
  transaction.set('status', 'captured');
  transaction.set('paymentGatewayRef', verification.reference);
  transaction.set('capturedAt', new Date());
  await transaction.save(null, { useMasterKey: true });

  const amount = transaction.get('amount');
  const mosque = await fetchPointer(transaction.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(transaction.get('requestId'), 'ServiceRequests');

  // increment ذرّي على مستوى قاعدة البيانات — آمن مع التبرعات المتزامنة
  mosque.increment('walletBalance', amount);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_CAPTURED,
    target: transaction,
    mosque,
    actor: transaction.get('donorId'),
    amount,
  });

  if (serviceRequest.get('fundedAmount') >= serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.FUNDED);
    serviceRequest.set('isFundedByDonors', true);
    serviceRequest.set('fundedAt', new Date());
    await serviceRequest.save(null, { useMasterKey: true });

    const imam = mosque.get('imamId');
    if (imam) {
      await pushToUsers(imam, {
        alert: `اكتمل تمويل "${serviceRequest.get('title')}" — يمكنك تعيين المنفّذ الآن.`,
        requestId: serviceRequest.id,
      });
    }
  }

  return { status: 'captured', fundedAmount: serviceRequest.get('fundedAmount') };
}

/**
 * مقارنة السرّ بزمن ثابت — المقارنة بـ`===` تُسرّب طول البادئة المطابقة.
 */
function secretMatches(provided, expected) {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * نقطة نهاية البوابة.
 *
 * تُستدعى من ثواني لا من مستخدم، فلا جلسة معها — التوثيق بسرّ مشترك يُضبط في
 * `PAYMENT_WEBHOOK_SECRET` ويُسجَّل في لوحة البوابة.
 *
 * **جسم الطلب لا يُصدَّق إطلاقاً.** كل ما يُؤخذ منه هو معرّف المعاملة، ثم تُسأل
 * البوابة عن حالتها الحقيقية. من يعرف السرّ يستطيع أن يطلب إعادة الفحص، لا أن
 * يُقرّر أن الدفع تمّ.
 *
 * أفضلُ من المهمة الدورية لأن القيد يتمّ لحظة الدفع لا بعد ساعة، والمهمة تبقى
 * شبكة أمان لما يضيع من الطلبات.
 */
Parse.Cloud.define('paymentWebhook', async (request) => {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!expected) E.forbidden('نقطة نهاية البوابة غير مهيأة.');
  if (!secretMatches(request.params.secret, expected)) E.forbidden('توثيق غير صالح.');

  // ثواني تُعيد معرّف المعاملة في client_reference_id كما أُرسل عند إنشاء الجلسة
  const transactionId = request.params.clientReferenceId || request.params.client_reference_id;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const transaction = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (transaction.get('status') === 'captured') {
    return { status: 'captured', message: 'سبق قيد هذه المعاملة.' };
  }
  if (transaction.get('status') !== 'pending') {
    return { status: transaction.get('status'), message: 'حالة المعاملة لا تسمح بالقيد.' };
  }

  const verification = await payments.verifySession(transaction.get('paymentSessionId'));

  if (!verification.paid) {
    if (!verification.terminal) return { status: 'pending' };
    transaction.set('status', 'failed');
    await transaction.save(null, { useMasterKey: true });
    return { status: 'failed' };
  }

  if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
    transaction.set('status', 'mismatch');
    await transaction.save(null, { useMasterKey: true });
    E.invalid('المبلغ المدفوع لا يطابق المبلغ المسجّل.');
  }

  return captureDonation(transaction, verification);
});

/**
 * صرف المستحقات للشركة بعد اعتماد الإمام. مشرف فقط.
 * التحويل الفعلي يتم خارج النظام (حوالة بنكية) — هنا نسجّل القيد فقط.
 */
Parse.Cloud.define('payoutContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { requestId, amount, bankRef } = request.params;

  const serviceRequest = await new Parse.Query('ServiceRequests')
    .include('mosqueId').include('assignedContractorId')
    .get(requestId, { useMasterKey: true })
    .catch(() => E.notFound('الطلب غير موجود.'));

  if (serviceRequest.get('status') !== STATUS.COMPLETED) E.invalid('لم يُعتمد العمل بعد.');
  if (serviceRequest.get('isPaidOut')) E.duplicate('تم الصرف لهذا الطلب مسبقاً.');

  const mosque = serviceRequest.get('mosqueId');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) E.invalid('المبلغ غير صحيح.');

  // الخصم أولاً بعملية ذرّية ثم التحقق. فحصُ الرصيد قبل الخصم لا يمنع صرفين
  // متزامنين من اجتيازه معاً، و`increment` ذرّي لكن القراءة التي تسبقه ليست كذلك.
  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', value); // تعويض: إعادة ما خُصم
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي.');
  }

  // يُعلَّم الطلب مصروفاً فور تأمين المبلغ، قبل قيد المعاملة، تضييقاً لنافذة
  // الصرف المزدوج. الإغلاق التام يحتاج قيداً على مستوى قاعدة البيانات.
  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  const Transaction = Parse.Object.extend('Transactions');
  const payout = new Transaction();
  payout.set('mosqueId', mosque);
  payout.set('requestId', serviceRequest);
  payout.set('payeeId', serviceRequest.get('assignedContractorId'));
  payout.set('amount', value);
  payout.set('type', 'payout');
  payout.set('status', 'captured');
  payout.set('paymentGatewayRef', String(bankRef || ''));
  payout.set('approvedBy', admin);
  await payout.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.PAYOUT_RECORDED,
    target: payout,
    mosque,
    actor: admin,
    amount: value,
  });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
});

/**
 * استرداد تبرّع مُقيَّد — مشرف فقط.
 *
 * كان المسار مفقوداً كلياً: طلبٌ يُلغى بعد التمويل، أو تمويلٌ زائد أفلت من
 * الحجز، كلاهما بلا مخرج إلا تعديل قاعدة البيانات يدوياً. التحويل الفعلي يتم
 * خارج النظام كما في الصرف — هنا يُسجَّل القيد ويُعاد الطلب إلى حالة التمويل.
 */
Parse.Cloud.define('refundDonation', async (request) => {
  const admin = requireRole(request, 'admin');
  const { transactionId, reason } = request.params;
  if (!transactionId) E.invalid('معرّف المعاملة مطلوب.');

  const original = await new Parse.Query('Transactions')
    .get(String(transactionId), { useMasterKey: true })
    .catch(() => E.notFound('المعاملة غير موجودة.'));

  if (original.get('type') !== 'donation') E.invalid('الاسترداد للتبرعات وحدها.');
  if (original.get('status') === 'refunded') E.duplicate('سبق استرداد هذه المعاملة.');
  if (original.get('status') !== 'captured') E.invalid('لا يُسترد إلا مبلغ مُقيَّد.');

  const amount = original.get('amount');
  const mosque = await fetchPointer(original.get('mosqueId'), 'Mosques');
  const serviceRequest = await fetchPointer(original.get('requestId'), 'ServiceRequests');

  if (serviceRequest.get('isPaidOut')) {
    E.forbidden('صُرفت مستحقات هذا الطلب — الاسترداد بعده تسوية محاسبية يدوية.');
  }

  // الخصم أولاً ثم التحقق، كما في الصرف: الرصيد قد يكون أُنفق على طلب آخر
  mosque.increment('walletBalance', -amount);
  await mosque.save(null, { useMasterKey: true });
  await mosque.fetch({ useMasterKey: true });

  if ((mosque.get('walletBalance') || 0) < 0) {
    mosque.increment('walletBalance', amount); // تعويض
    await mosque.save(null, { useMasterKey: true });
    E.invalid('رصيد المسجد لا يكفي للاسترداد — رُوجع في طلبات أخرى.');
  }

  original.set('status', 'refunded');
  await original.save(null, { useMasterKey: true });

  serviceRequest.increment('fundedAmount', -amount);
  await serviceRequest.save(null, { useMasterKey: true });
  await serviceRequest.fetch({ useMasterKey: true });

  // الطلب لم يعد مموّلاً بالكامل، فيعود لاستقبال التمويل
  if (serviceRequest.get('status') === STATUS.FUNDED
      && serviceRequest.get('fundedAmount') < serviceRequest.get('estimatedCost')) {
    serviceRequest.set('status', STATUS.PENDING_FUNDING);
    serviceRequest.set('isFundedByDonors', false);
    await serviceRequest.save(null, { useMasterKey: true });
  }

  const Transaction = Parse.Object.extend('Transactions');
  const entry = new Transaction();
  entry.set('mosqueId', mosque);
  entry.set('requestId', serviceRequest);
  entry.set('payeeId', original.get('donorId'));
  entry.set('amount', amount);
  entry.set('type', 'refund');
  entry.set('status', 'captured');
  entry.set('paymentGatewayRef', String(reason || ''));
  entry.set('approvedBy', admin);
  await entry.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.DONATION_REFUNDED,
    target: entry,
    mosque,
    actor: admin,
    amount,
  });

  return { message: 'سُجّل الاسترداد.', transactionId: entry.id, fundedAmount: serviceRequest.get('fundedAmount') };
});

/** سجل شفاف لكل مسجد — متاح للجميع، بلا بيانات شخصية للمتبرعين. */
Parse.Cloud.define('getMosqueLedger', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const transactions = await new Parse.Query('Transactions')
    .equalTo('mosqueId', mosque)
    .equalTo('status', 'captured')
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return transactions.map((t) => ({
    id: t.id,
    amount: t.get('amount'),
    type: t.get('type'),
    createdAt: t.get('createdAt'),
    requestId: t.get('requestId') ? t.get('requestId').id : null,
  }));
});

/**
 * مراجعة المعاملات المعلّقة.
 *
 * `confirmDonation` تُستدعى عند عودة المستخدم من صفحة الدفع، فإن أغلق التطبيق
 * بعد الدفع مباشرة بقيت معاملته `pending` ومالُه غير مقيَّد. تُجدوَل هذه المهمة
 * من لوحة Back4app (Server Settings → Background Jobs) كل ساعة.
 *
 * تسأل البوابة عن كل معاملة معلّقة تجاوزت مهلة الحجز:
 *   دُفعت    → تُقيَّد عبر `captureDonation` نفسها التي تستعملها الدالة
 *   انتهت    → `failed`
 *   مفتوحة   → تُترك، إلا إذا تجاوزت المهلة القصوى فتصير `expired`
 */
const PENDING_MAX_AGE_HOURS = 24;

Parse.Cloud.job('reviewPendingDonations', async (request) => {
  const { message } = request;

  if (!payments.isConfigured()) {
    message('بوابة الدفع غير مهيأة — لا شيء لمراجعته.');
    return 'skipped';
  }

  const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const stale = await new Parse.Query('Transactions')
    .equalTo('type', 'donation')
    .equalTo('status', 'pending')
    .lessThan('createdAt', cutoff)
    .limit(100)
    .find({ useMasterKey: true });

  const counts = { captured: 0, failed: 0, expired: 0, open: 0, errors: 0 };
  const expiryLimit = new Date(Date.now() - PENDING_MAX_AGE_HOURS * 3600 * 1000);

  for (const transaction of stale) {
    try {
      const verification = await payments.verifySession(transaction.get('paymentSessionId'));

      if (verification.paid) {
        // نفس فحص المطابقة الذي في confirmDonation — لا يُقيَّد مبلغ مخالف
        if (Math.abs(verification.amountOmr - transaction.get('amount')) > 0.001) {
          transaction.set('status', 'mismatch');
          await transaction.save(null, { useMasterKey: true });
          counts.errors += 1;
          continue;
        }
        await captureDonation(transaction, verification);
        counts.captured += 1;
      } else if (verification.terminal) {
        transaction.set('status', 'failed');
        await transaction.save(null, { useMasterKey: true });
        counts.failed += 1;
      } else if (transaction.get('createdAt') < expiryLimit) {
        transaction.set('status', 'expired');
        await transaction.save(null, { useMasterKey: true });
        await audit.record({
          action: audit.ACTIONS.DONATION_EXPIRED,
          target: transaction,
          mosque: transaction.get('mosqueId'),
          amount: transaction.get('amount'),
        });
        counts.expired += 1;
      } else {
        counts.open += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error('[reviewPendingDonations]', transaction.id, error && error.message);
    }
  }

  const summary = `فُحصت ${stale.length}: قُيّدت ${counts.captured}، فشلت ${counts.failed}، `
    + `انتهت ${counts.expired}، ما تزال مفتوحة ${counts.open}، أخطاء ${counts.errors}`;
  message(summary);
  return summary;
});

/**
 * سجل التدقيق لمسجد — من فعل ماذا ومتى.
 * `getMosqueLedger` يُظهر المال، وهذا يُظهر القرارات. هوية الفاعل لا تُعاد،
 * دوره فقط: الغرض تتبّع المسار لا كشف الأشخاص.
 */
Parse.Cloud.define('getMosqueAuditTrail', async (request) => {
  requireUser(request);
  const { mosqueId, limit = 50 } = request.params;
  if (!mosqueId) E.invalid('معرّف المسجد مطلوب.');

  const mosque = new Parse.Object('Mosques');
  mosque.id = mosqueId;

  const entries = await new Parse.Query('AuditLog')
    .equalTo('mosqueId', mosque)
    .descending('createdAt')
    .limit(Math.min(Number(limit) || 50, 100))
    .find({ useMasterKey: true });

  return entries.map((entry) => ({
    action: entry.get('action'),
    targetClass: entry.get('targetClass'),
    targetId: entry.get('targetId'),
    fromStatus: entry.get('fromStatus'),
    toStatus: entry.get('toStatus'),
    actorRole: entry.get('actorRole'),
    amount: entry.get('amount'),
    createdAt: entry.get('createdAt'),
  }));
});


// ======================================================================
// شؤون الحسابات   [functions/users.js]
// ======================================================================

/**
 * شؤون الحسابات: اعتماد الشركات، والملف الشخصي.
 *
 * اعتماد الشركة كان بلا مسار أصلاً: جدول الأدوار يقول إن المشرف «يعتمد
 * الشركات»، و`beforeSave` يحظر تعديل `isVerifiedContractor` إلا بـ Master Key —
 * فلم يكن أمام المشرف إلا تعديل السجل يدوياً من لوحة التحكم، بلا أثر في السجل.
 */

/** الشركات المنتظرة اعتماداً — مشرف فقط. */
Parse.Cloud.define('listPendingContractors', async (request) => {
  requireRole(request, 'admin');

  const contractors = await new Parse.Query(Parse.User)
    .equalTo('role', 'contractor')
    .equalTo('isVerifiedContractor', false)
    .ascending('createdAt')
    .limit(100)
    .find({ useMasterKey: true });

  return contractors.map((contractor) => ({
    id: contractor.id,
    fullName: contractor.get('fullName'),
    companyName: contractor.get('companyName'),
    crNumber: contractor.get('crNumber'), // السجل التجاري — أساس الاعتماد
    phone: contractor.get('phone'),
    createdAt: contractor.get('createdAt'),
  }));
});

/** اعتماد شركة أو سحب اعتمادها — مشرف فقط. */
Parse.Cloud.define('reviewContractor', async (request) => {
  const admin = requireRole(request, 'admin');
  const { contractorId, approve } = request.params;
  if (!contractorId) E.invalid('معرّف الشركة مطلوب.');

  const contractor = await new Parse.Query(Parse.User)
    .get(contractorId, { useMasterKey: true })
    .catch(() => E.notFound('المستخدم غير موجود.'));

  if (contractor.get('role') !== 'contractor') E.invalid('هذا المستخدم ليس شركة خدمات.');

  const verified = Boolean(approve);
  if (verified && !contractor.get('crNumber')) {
    E.invalid('لا يُعتمد مزوّد بلا رقم سجل تجاري.');
  }

  contractor.set('isVerifiedContractor', verified);
  await contractor.save(null, { useMasterKey: true });

  await audit.record({
    action: audit.ACTIONS.CONTRACTOR_REVIEWED,
    target: contractor,
    actor: admin,
    toStatus: verified ? 'verified' : 'unverified',
  });

  await pushToUsers(contractor, {
    alert: verified ? 'تم اعتماد شركتكم في منصة مسجدي.' : 'أُوقف اعتماد شركتكم مؤقتاً.',
  });

  return { isVerifiedContractor: verified };
});

/**
 * ضبط المسجد المفضّل — نقطة الدخول الافتراضية في التطبيق.
 * تمرّ بدالة سحابة لا بكتابة مباشرة، للتحقق من وجود المسجد قبل ربط المؤشّر.
 */
Parse.Cloud.define('setFavoriteMosque', async (request) => {
  const user = requireUser(request);
  const { mosqueId } = request.params;

  if (!mosqueId) {
    user.unset('favoriteMosqueId');
    await user.save(null, { useMasterKey: true });
    return { favoriteMosqueId: null };
  }

  const mosque = await new Parse.Query('Mosques')
    .get(String(mosqueId), { useMasterKey: true })
    .catch(() => E.notFound('المسجد غير موجود.'));

  user.set('favoriteMosqueId', mosque);
  await user.save(null, { useMasterKey: true });

  return { favoriteMosqueId: mosque.id, mosqueName: mosque.get('name') };
});

/** ملف المستخدم كما يعرضه التطبيق. */
Parse.Cloud.define('getMyProfile', async (request) => {
  const user = requireUser(request);
  await user.fetch({ useMasterKey: true });

  const favorite = user.get('favoriteMosqueId');
  let favoriteName = null;
  if (favorite) {
    const loaded = await favorite.fetch({ useMasterKey: true }).catch(() => null);
    favoriteName = loaded ? loaded.get('name') : null;
  }

  return {
    id: user.id,
    role: user.get('role'),
    fullName: user.get('fullName'),
    phone: user.get('phone'),
    skills: user.get('skills') || [],
    governorate: user.get('governorate'),
    wilayat: user.get('wilayat'),
    companyName: user.get('companyName'),
    crNumber: user.get('crNumber'),
    isVerifiedContractor: Boolean(user.get('isVerifiedContractor')),
    completedJobs: user.get('completedJobs') || 0,
    avgRating: user.get('avgRating'),
    favoriteMosqueId: favorite ? favorite.id : null,
    favoriteMosqueName: favoriteName,
  };
});


// ======================================================================
// الصيانة الدورية   [functions/maintenance.js]
// ======================================================================

/**
 * صيانة دورية للبيانات المتراكمة.
 */

// `AuditLog` ينمو بسطر لكل تحوّل حالة وكل حركة مال، وباقة Back4app المجانية
// 250 ميغابايت تشترك فيها بيانات 18 ألف مسجد. ستة أشهر تكفي للمساءلة أمام
// المتبرّع، وما قبلها يُؤرشَف خارج المنصّة إن لزم.
const AUDIT_RETENTION_DAYS = 180;
const PRUNE_BATCH = 500;

Parse.Cloud.job('pruneAuditLog', async (request) => {
  const { params, message } = request;

  const days = Math.max(Number(params.retentionDays) || AUDIT_RETENTION_DAYS, 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

  let removed = 0;
  for (;;) {
    const batch = await new Parse.Query('AuditLog')
      .lessThan('createdAt', cutoff)
      .limit(PRUNE_BATCH)
      .find({ useMasterKey: true });

    if (batch.length === 0) break;
    await Parse.Object.destroyAll(batch, { useMasterKey: true });
    removed += batch.length;

    message(`حُذف ${removed} سطراً حتى الآن…`);
    if (batch.length < PRUNE_BATCH) break;
  }

  const summary = `حُذف ${removed} سطر تدقيق أقدم من ${days} يوماً.`;
  message(summary);
  return summary;
});


// ======================================================================
// فحص حالة الخادم
// ======================================================================

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: payments.isConfigured(),
}));
```

---

## 7. دورة حياة الطلب والدوال وقواعد الأمن

### الأدوار
| الدور | ما يستطيع |
|---|---|
| `imam` | تسجيل ملكية مسجد، إنشاء طلبات، تعيين منفّذ، اعتماد العمل |
| `volunteer` | تصفّح الفرص القريبة، **تسجيل الاهتمام بمهمة**، تنفيذ العمل العيني، رفع صور الإنجاز |
| `donor` | تمويل الطلبات، متابعة السجل المالي للمسجد |
| `contractor` | تنفيذ الأعمال المموّلة (بعد الاعتماد فقط) |
| `admin` | مراجعة طلبات الملكية، اعتماد الشركات، صرف المستحقات |

### دورة الحياة
```
مسار مموّل:
  pending_funding → funded → assigned → in_progress
                  → pending_imam_approval → completed → (payout)

مسار تطوّعي عيني (لا مال):
  open_for_volunteers → assigned → in_progress
                      → pending_imam_approval → completed
       ↑
   المتطوّعون يُسجّلون اهتمامهم (TaskInterests) — لا يُغيّر الحالة
```

**كيف يصل المتطوّع إلى المهمة:** يُسجّل اهتمامه عبر `expressInterest`، فيُشعَر
الإمام ويرى المهتمّين بمهاراتهم وتقييمهم عبر `getRequestInterests`، ثم يختار
واحداً عبر `assignWorker`. الاهتمام **لا يحجز الطلب ولا يُغيّر حالته** — الإمام
يبقى صاحب القرار، وتُقفَل بقية الاهتمامات تلقائياً عند التكليف.

الإلغاء متاح قبل بدء التنفيذ وبشرط `fundedAmount = 0`. بعد `in_progress` يُرفض:
العمل بدأ، والمخرج هو المعاينة والاعتماد لا الإلغاء. ويُشعَر المنفّذ المكلَّف
عند إلغاء طلب أُسند إليه.

نقطة تصميم مهمة: **المنفّذ يبلّغ بالإنجاز، والإمام هو من يُقفل الطلب.**
هذا يمنع إقفال طلبات لم تُنفَّذ فعلاً.

### دوال السحابة

| الدالة | المستدعي | الوصف |
|---|---|---|
| `getNearbyMosques` | الجميع | مساجد ضمن نطاق (سقف 50 كم، 100 نتيجة) |
| `searchMosques` | الجميع | بحث نصّي مع تطبيع عربي |
| `claimMosque` | imam | طلب ملكية مسجد |
| `getMyClaims` | imam | حالة طلبات الملكية الخاصة به |
| `reviewMosqueClaim` | admin | اعتماد/رفض الطلب |
| `createServiceRequest` | imam | إنشاء طلب صيانة |
| `expressInterest` | volunteer | تسجيل الاهتمام بطلب مفتوح |
| `withdrawInterest` | volunteer | سحب الاهتمام قبل الاختيار |
| `getRequestInterests` | imam | قائمة المهتمّين بمهاراتهم وتقييمهم |
| `assignWorker` | imam | تعيين متطوع أو شركة |
| `startWork` | المنفّذ | بدء التنفيذ |
| `markWorkDone` | المنفّذ | إبلاغ بالإنجاز + صور |
| `completeService` | imam | معاينة واعتماد وتقييم |
| `cancelServiceRequest` | imam | إلغاء قبل التنفيذ |
| `initiateDonation` | متبرع | إنشاء جلسة دفع |
| `confirmDonation` | متبرع/نظام | تأكيد من البوابة وقيد المبلغ |
| `paymentWebhook` | البوابة | قيد لحظي — توثيق بسرّ مشترك، والجسم لا يُصدَّق |
| `payoutContractor` | admin | تسجيل صرف المستحقات |
| `refundDonation` | admin | استرداد تبرّع مُقيَّد وإعادة الطلب للتمويل |
| `listPendingContractors` | admin | الشركات المنتظرة اعتماداً بسجلّها التجاري |
| `reviewContractor` | admin | اعتماد شركة أو سحب اعتمادها |
| `getMyProfile` | الجميع | الملف الشخصي كما يعرضه التطبيق |
| `setFavoriteMosque` | الجميع | ضبط المسجد المفضّل |
| `getMosqueLedger` | الجميع | السجل المالي الشفاف |
| `getMosqueAuditTrail` | الجميع | سجل القرارات — الدور لا هوية الفاعل |
| `health` | الجميع | فحص حالة الخادم |

### المهام الدورية

تُجدوَل من لوحة Back4app (Server Settings → Background Jobs).

| المهمة | التواتر المقترح | الوصف |
|---|---|---|
| `reviewPendingDonations` | كل ساعة | شبكة أمان خلف الـwebhook: تسأل البوابة عن كل معاملة معلّقة تجاوزت مهلة الحجز |
| `pruneAuditLog` | أسبوعياً | حذف سطور التدقيق الأقدم من 180 يوماً |

### قواعد الأمن

| الفئة | القراءة | الكتابة |
|---|---|---|
| `_User` | صاحب الحساب فقط — `afterSave` يقفل الـ ACL عليه عند التسجيل، وقراءة بيانات مستخدم آخر تمرّ عبر دوال السحابة | المستخدم نفسه، مع حظر تعديل `role=admin` و`isVerifiedContractor` |
| `Mosques` | مصادَق | Master Key فقط |
| `ServiceRequests` | مصادَق | Master Key فقط (عبر دوال السحابة) |
| `Transactions` | مصادَق، مع إخفاء بيانات المتبرع | Master Key فقط |
| `MosqueClaims` | Master Key فقط | Master Key فقط |
| `TaskInterests` | Master Key فقط — يُقرأ عبر `getRequestInterests` بعد التحقق من ملكية المسجد | Master Key فقط |
| `AuditLog` | Master Key فقط — يُقرأ عبر `getMosqueAuditTrail` | Master Key فقط |

**تنبيه:** Master Key في متغيرات بيئة الخادم فقط. لا يظهر إطلاقاً في كود التطبيق.

### تكامل منصة "أيادي" (مستقبلاً)

تسجيل ساعات التطوّع تلقائياً عند اعتماد الإمام. يحتاج اتفاقية رسمية ومفتاح API.
موضع الربط معلّم بـ `TODO` داخل `completeService`.

---

## 8. البيانات

### المصدر

البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية — سلطنة عُمان.
فترة المرجع 2025–2026، تاريخ الإصدار 17 مارس 2026، تحديث سنوي.
جهة الاتصال: `info@mara.om` — 80008008.

ملفان:
1. `Masajid Data with geographic locations.xlsx` — 18,214 صفاً بالإحداثيات.
2. `Masajid by Governorate.xlsx` — إجماليات حسب النوع (للمقارنة فقط).

### التوزيع

| النوع | العدد |
|---|---|
| مسجد | 14,338 |
| جامع | 1,952 |
| مصلى العيدين | 929 |
| مصلى | 752 |
| مصلى نساء (خاص) | 210 |
| مصلى خاص بالجنائز | 32 |

| المحافظة | العدد |
|---|---|
| الداخلية | 3,661 |
| شمال الشرقية | 2,491 |
| شمال الباطنة | 2,409 |
| جنوب الباطنة | 2,240 |
| الظاهرة | 2,069 |
| مسقط | 1,716 |
| جنوب الشرقية | 1,674 |
| ظفار | 831 |
| البريمي | 522 |
| الوسطى | 337 |
| مسندم | 264 |

63 ولاية. ملاحظة: الإجماليات في الملف الثاني (18,003) لا تطابق عدد الصفوف
في الملف الأول (18,214) — فرق 211 سجلاً غير مفسّر في المصدر.

### المشاكل التي عالجها سكربت التنظيف

#### 1. أرقام المساجد تحوّلت إلى تواريخ (1,404 صف)

صيغة الرقم `رمز_الولاية/التسلسل` مثل `39/196`. إكسل فسّر كل قيمة رمز
ولايتها ≤ 12 على أنها تاريخ:

| القيمة في الملف | الأصل الصحيح |
|---|---|
| `1979-05-01` | `05/1979` |
| `2026-02-06` | `02/6` |

القاعدة: إذا كانت السنة ≠ 2026 فالأصل `شهر/سنة`؛ وإذا كانت = 2026 فالأصل
`شهر/يوم`. تحقّقت القاعدة على كل الصفوف (كل التواريخ خارج 2026 يومها = 1).
**24 صفاً تبقى ملتبسة** (سنة 2026 ويوم 1) ومُعلّمة بـ `recovered_ambiguous`.

#### 2. إحداثيات معطوبة (25 صفاً)

- **9 صفوف**: خط الطول وخط العرض مقلوبان — صُحّحت تلقائياً بمطابقة حدود عُمان
  (خط العرض 16.4–26.6، خط الطول 51.8–60.2).
- **13 صفاً**: خارج حدود السلطنة تماماً (أحدها في الهند، وآخر إحداثياته ≈ 0,0).
- **3 صفوف**: بلا إحداثيات.

الصفوف الـ16 غير القابلة للإصلاح استُوردت بـ `hasLocation = false` — تظهر في
البحث النصّي لا في الخريطة، ويمكن للإمام تصحيح الموقع عند تسجيل المسجد.

#### 3. التطبيع للبحث العربي

حقل `nameNormalized` يزيل التشكيل ويوحّد أ/إ/آ→ا، ى→ي، ة→ه. بدونه لن يجد
المستخدم "مسجد الرحمه" عند كتابة "الرحمة".

### تقرير التشغيل الأخير

```json
{
  "rows_in": 18214,
  "rows_out": 18214,
  "number_flags": { "ok": 16810, "recovered_from_date": 1380, "recovered_ambiguous": 24 },
  "coord_flags": { "ok": 18189, "swapped": 9, "out_of_bounds": 13, "missing": 3 },
  "duplicate_keys": 0
}
```

### إعادة التوليد

```bash
python3 scripts/clean_mosques.py "path/to/Masajid Data with geographic locations.xlsx"
```

المخرجات في `data/`. المفتاح `externalId` ثابت بين التشغيلات، لذا إعادة
الاستيراد تُحدّث ولا تُكرّر.

### الترخيص

بيانات حكومية مفتوحة. راجع شروط بوابة البيانات المفتوحة العُمانية قبل النشر
التجاري، ويُستحسن ذكر الوزارة كمصدر داخل التطبيق.

---

## 9. سكربتات التجهيز

### `scripts/clean_mosques.py` — تنظيف ملف الوزارة

```python
#!/usr/bin/env python3
"""
تنظيف بيانات المساجد الصادرة عن وزارة الأوقاف والشؤون الدينية
Input : Masajid Data with geographic locations.xlsx  (sheet: "Data ")
Output: data/mosques.json  + data/mosques.sample.json + data/cleaning_report.json

يعالج ثلاث مشاكل معروفة في الملف الأصلي:
  1) MosqueNumber تحوّل إلى تواريخ في إكسل (1404 صف).
  2) إحداثيات مقلوبة (خط الطول مكان خط العرض) أو خارج حدود عُمان.
  3) صفوف بدون إحداثيات إطلاقاً.

الاستخدام:
    python3 scripts/clean_mosques.py "path/to/Masajid Data with geographic locations.xlsx"
"""

import json
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# الحدود الجغرافية التقريبية لسلطنة عُمان (تشمل مسندم)
OMAN_LAT = (16.4, 26.6)
OMAN_LON = (51.8, 60.2)

# سنة إصدار الملف — أي تاريخ بهذه السنة يعني أن إكسل فسّر "شهر/يوم"
FILE_YEAR = 2026

TYPE_SLUG = {
    "جامع": "jamie",
    "مسجد": "masjid",
    "مصلى": "musalla",
    "مصلى العيدين": "musalla_eid",
    "مصلى نساء ( خاص )": "musalla_women",
    "مصلى خاص بالجنائز": "musalla_janaza",
}

GOV_SLUG = {
    "مسقط": "muscat",
    "ظفار": "dhofar",
    "مسندم": "musandam",
    "البريمي": "buraimi",
    "الداخلية": "dakhiliyah",
    "شمال الباطنة": "north_batinah",
    "جنوب الباطنة": "south_batinah",
    "شمال الشرقية": "north_sharqiyah",
    "جنوب الشرقية": "south_sharqiyah",
    "الظاهرة": "dhahirah",
    "الوسطى": "wusta",
}


def fix_mosque_number(value):
    """
    يعيد بناء رقم المسجد "رمز_الولاية/التسلسل".
    إكسل حوّل القيم التي رمز ولايتها <= 12 إلى تواريخ:
      "05/1979" -> datetime(1979, 5, 1)     (سنة != سنة الملف، اليوم = 1)
      "02/6"    -> datetime(2026, 2, 6)     (سنة == سنة الملف)
    """
    if isinstance(value, (datetime, pd.Timestamp)):
        if value.year != FILE_YEAR:
            return f"{value.month:02d}/{value.year}", "recovered_from_date"
        # حالة نادرة (24 صفاً): "M/1" و "M/{FILE_YEAR}" غير قابلتين للتمييز
        flag = "recovered_ambiguous" if value.day == 1 else "recovered_from_date"
        return f"{value.month:02d}/{value.day}", flag
    return str(value).strip(), "ok"


def fix_coordinates(lon, lat):
    """يعيد (lon, lat, flag). يصحّح الانقلاب ويرفض ما هو خارج حدود عُمان."""
    if pd.isna(lon) or pd.isna(lat):
        return None, None, "missing"

    def inside(lo, la):
        return OMAN_LON[0] <= lo <= OMAN_LON[1] and OMAN_LAT[0] <= la <= OMAN_LAT[1]

    if inside(lon, lat):
        return round(float(lon), 7), round(float(lat), 7), "ok"
    if inside(lat, lon):  # الأعمدة مقلوبة
        return round(float(lat), 7), round(float(lon), 7), "swapped"
    return None, None, "out_of_bounds"


def normalize_ar(text):
    """توحيد النص العربي: إزالة التشكيل والمسافات الزائدة وتوحيد الألف والياء والتاء المربوطة."""
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    for src, dst in (("أإآ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي")):
        for ch in src:
            text = text.replace(ch, dst)
    return " ".join(text.split())


def main(xlsx_path: str, out_dir: str = "data"):
    df = pd.read_excel(xlsx_path, sheet_name="Data ")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    records, report = [], {
        "source_file": Path(xlsx_path).name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rows_in": int(len(df)),
        "number_flags": {},
        "coord_flags": {},
        "dropped_no_location": 0,
        "duplicate_keys": 0,
    }

    seen = set()
    for _, row in df.iterrows():
        number, nflag = fix_mosque_number(row["MosqueNumber"])
        lon, lat, cflag = fix_coordinates(row["Longitude"], row["Latitude"])

        report["number_flags"][nflag] = report["number_flags"].get(nflag, 0) + 1
        report["coord_flags"][cflag] = report["coord_flags"].get(cflag, 0) + 1

        mtype = row["MosqueType"] if isinstance(row["MosqueType"], str) else "مسجد"
        name = str(row["MosqueName"]).strip()
        gov = str(row["Governorate"]).strip()
        wilayat = str(row["Willayat"]).strip()
        village = str(row["Village"]).strip()

        # مفتاح ثابت لمنع التكرار عند إعادة تشغيل السكربت (idempotent seeding)
        external_id = f"{number}|{normalize_ar(name)}|{normalize_ar(village)}"
        if external_id in seen:
            report["duplicate_keys"] += 1
            continue
        seen.add(external_id)

        if lat is None:
            report["dropped_no_location"] += 1
            # نحتفظ بالسجل لكن بدون موقع — يُستورد كمسجد "يحتاج تحديد موقع"
            location = None
        else:
            location = {"__type": "GeoPoint", "latitude": lat, "longitude": lon}

        records.append({
            "externalId": external_id,
            "mosqueNumber": number,
            "name": name,
            "nameNormalized": normalize_ar(name),
            "type": mtype,
            "typeSlug": TYPE_SLUG.get(mtype, "masjid"),
            "governorate": gov,
            "governorateSlug": GOV_SLUG.get(gov, ""),
            "wilayat": wilayat,
            "village": village,
            "location": location,
            "hasLocation": location is not None,
            "dataQuality": {"number": nflag, "coordinates": cflag},
            "source": "MARA Open Data 2025-2026",
            "isClaimed": False,
            "walletBalance": 0,
        })

    report["rows_out"] = len(records)

    (out / "mosques.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=None), encoding="utf-8")
    (out / "mosques.sample.json").write_text(
        json.dumps(records[:50], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "cleaning_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "Masajid Data with geographic locations.xlsx"
    main(src)
```

### `scripts/apply_schema.js` — تطبيق المخطط

```javascript
#!/usr/bin/env node
/**
 * تطبيق مخطط قاعدة البيانات من cloud/schema.json على Parse Server.
 * يُنشئ الفئات والحقول والفهارس الناقصة. لا يحذف شيئاً.
 *
 *   node scripts/apply_schema.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');

const schemaFile = path.join(__dirname, '..', 'cloud', 'schema.json');

async function main() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة (.env).');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;

  const { classes } = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));

  for (const definition of classes) {
    const schema = new Parse.Schema(definition.className);
    let existing = null;
    try {
      existing = await schema.get();
    } catch (_) {
      // الفئة غير موجودة بعد
    }

    const existingFields = existing ? existing.fields : {};

    for (const [name, spec] of Object.entries(definition.fields || {})) {
      if (existingFields[name]) continue;
      const options = {};
      if (spec.required) options.required = true;
      if (spec.defaultValue !== undefined) options.defaultValue = spec.defaultValue;

      if (spec.type === 'Pointer') schema.addPointer(name, spec.targetClass, options);
      else schema[`add${spec.type}`](name, options);
    }

    if (definition.classLevelPermissions) {
      schema.setCLP(definition.classLevelPermissions);
    }

    try {
      existing ? await schema.update() : await schema.save();
      console.log(`✓ ${definition.className}`);
    } catch (error) {
      console.error(`✗ ${definition.className}: ${error.message}`);
    }
  }

  console.log('\nملاحظة: فهارس 2dsphere والفهارس المركّبة تُضاف من لوحة Back4app');
  console.log('(Database → Indexes) أو عبر MongoDB shell — Parse SDK لا يديرها.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### `scripts/seed_mosques.js` — استيراد 18 ألف مسجد

```javascript
#!/usr/bin/env node
/**
 * استيراد بيانات المساجد (18,214 سجلاً) إلى Parse.
 *
 * قابل لإعادة التشغيل (idempotent): يعتمد على externalId، فإعادة التشغيل
 * تُحدّث ولا تُكرّر. يستخدم Master Key، لذا يُشغّل من جهازك أو من CI فقط.
 *
 *   node scripts/seed_mosques.js            # استيراد كامل
 *   node scripts/seed_mosques.js --limit 100  # تجربة سريعة
 *   node scripts/seed_mosques.js --dry-run
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Parse = require('parse/node');

const BATCH_SIZE = 200; // Parse.Object.saveAll يتعامل داخلياً بدفعات — نبقيها معتدلة
const DATA_FILE = path.join(__dirname, '..', 'data', 'mosques.json');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const dryRun = args.includes('--dry-run');

function initParse() {
  const { PARSE_APP_ID, PARSE_MASTER_KEY, PARSE_JS_KEY, PARSE_SERVER_URL } = process.env;
  if (!PARSE_APP_ID || !PARSE_MASTER_KEY || !PARSE_SERVER_URL) {
    console.error('✗ متغيرات البيئة ناقصة. انسخ .env.example إلى .env واملأه.');
    process.exit(1);
  }
  Parse.initialize(PARSE_APP_ID, PARSE_JS_KEY || '', PARSE_MASTER_KEY);
  Parse.serverURL = PARSE_SERVER_URL;
}

async function existingIds() {
  const found = new Map();
  const query = new Parse.Query('Mosques');
  query.select('externalId');
  query.limit(1000);
  let cursor = null;
  for (;;) {
    if (cursor) query.greaterThan('objectId', cursor);
    const page = await query.ascending('objectId').find({ useMasterKey: true });
    if (page.length === 0) break;
    page.forEach((m) => found.set(m.get('externalId'), m.id));
    cursor = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  return found;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const records = raw.slice(0, limit);
  console.log(`→ ${records.length} سجلاً جاهزاً للاستيراد`);

  if (dryRun) {
    console.log(JSON.stringify(records[0], null, 2));
    console.log('✓ تجربة جافة — لم يُكتب شيء.');
    return;
  }

  initParse();
  const Mosque = Parse.Object.extend('Mosques');
  const known = await existingIds();
  console.log(`→ موجود مسبقاً: ${known.size}`);

  let created = 0;
  let updated = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((row) => {
      const mosque = new Mosque();
      if (known.has(row.externalId)) {
        mosque.id = known.get(row.externalId);
        updated += 1;
      } else {
        created += 1;
      }

      mosque.set('externalId', row.externalId);
      mosque.set('mosqueNumber', row.mosqueNumber);
      mosque.set('name', row.name);
      mosque.set('nameNormalized', row.nameNormalized);
      mosque.set('type', row.type);
      mosque.set('typeSlug', row.typeSlug);
      mosque.set('governorate', row.governorate);
      mosque.set('governorateSlug', row.governorateSlug);
      mosque.set('wilayat', row.wilayat);
      mosque.set('village', row.village);
      mosque.set('hasLocation', row.hasLocation);
      mosque.set('source', row.source);
      mosque.set('dataQuality', row.dataQuality);

      if (row.location) {
        mosque.set('location', new Parse.GeoPoint({
          latitude: row.location.latitude,
          longitude: row.location.longitude,
        }));
      }

      // لا نلمس الحقول التشغيلية عند التحديث حتى لا نمسح رصيداً أو ملكية
      if (!known.has(row.externalId)) {
        mosque.set('isClaimed', false);
        mosque.set('walletBalance', 0);
        mosque.set('openRequestsCount', 0);
      }

      return mosque;
    });

    await Parse.Object.saveAll(batch, { useMasterKey: true });
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  console.log(`\n✓ تم. جديد: ${created} — محدّث: ${updated}`);
}

main().catch((error) => {
  console.error('\n✗ فشل الاستيراد:', error.message);
  process.exit(1);
});
```

### `scripts/build_single_file.py` — توليد النسخة المدمجة (القسم 6ب)

```python
#!/usr/bin/env python3
"""دمج ملفات Cloud Code في ملف main.js واحد صالح للصق في لوحة Back4app."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORDER = [
    ("lib/errors.js", "الأخطاء الموحّدة"),
    ("lib/auth.js", "الصلاحيات والأدوار"),
    ("lib/push.js", "الإشعارات"),
    ("lib/payments.js", "بوابة الدفع"),
    ("lib/audit.js", "سجل التدقيق"),
    ("triggers.js", "المُشغّلات (beforeSave / afterSave)"),
    ("functions/mosques.js", "دوال المساجد"),
    ("functions/requests.js", "دوال طلبات الصيانة"),
    ("functions/donations.js", "دوال التبرعات والصرف"),
    ("functions/users.js", "شؤون الحسابات"),
    ("functions/maintenance.js", "الصيانة الدورية"),
]

REPLACEMENTS = {
    "lib/errors.js": [(r"module\.exports = \{", "const E = {")],
    "lib/payments.js": [(r"module\.exports = \{[^}]*\};", "const payments = { isConfigured, createCheckoutSession, verifySession };")],
    "lib/audit.js": [(r"module\.exports = \{[^}]*\};", "const audit = { record, ACTIONS };")],
}

# يُحذف الاستيراد النسبي وحده (`./` و`../`): الملفات صارت واحداً فلا معنى له.
# استيراد وحدات Node مثل `crypto` يبقى — حذفه كان يترك مرجعاً غير معرّف في المدمج.
DROP = re.compile(
    r"^\s*(const .*= require\([\"']\.|module\.exports\s*=\s*\{\s*(ROLES|pushToUsers|STATUS)).*$")


def clean(path: Path, rel: str) -> str:
    text = path.read_text(encoding="utf-8")
    for pattern, repl in REPLACEMENTS.get(rel, []):
        text = re.sub(pattern, repl, text, flags=re.S)

    lines, skip_block = [], False
    for line in text.split("\n"):
        if skip_block:
            if line.strip().startswith("}"):
                skip_block = False
            continue
        if re.match(r"^module\.exports = \{$", line.strip()) and rel not in REPLACEMENTS:
            skip_block = True
            continue
        if DROP.match(line) and "= {" not in line:
            continue
        if re.match(r"^module\.exports = \{.*\};$", line.strip()) and rel not in REPLACEMENTS:
            continue
        lines.append(line)

    return "\n".join(lines).strip()


def main():
    parts = ["""/**
 * مسجدي (Masjidi) — Cloud Code كاملاً في ملف واحد
 * =================================================
 * الصق هذا الملف في: Back4app → Server Settings → Cloud Code → main.js → Deploy
 *
 * مولّد آلياً من مجلد cloud/ عبر scripts/build_single_file.py
 * للتطوير طويل الأمد استخدم النسخة المجزّأة — التعديل هنا يُفقد عند إعادة التوليد.
 */
"""]

    for rel, title in ORDER:
        body = clean(ROOT / "cloud" / rel, rel)
        parts.append(f"\n// {'=' * 70}\n// {title}   [{rel}]\n// {'=' * 70}\n\n{body}\n")

    parts.append("""
// ======================================================================
// فحص حالة الخادم
// ======================================================================

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: payments.isConfigured(),
}));
""")

    out = ROOT / "cloud" / "main.bundle.js"
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"✓ {out}  ({len(out.read_text(encoding='utf-8').splitlines())} سطراً)")


if __name__ == "__main__":
    main()
```

### `scripts/build_single_doc.py` — توليد هذا الملف

```python
#!/usr/bin/env python3
"""تجميع المشروع كاملاً في ملف واحد: MASJIDI.md"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "MASJIDI.md"

BT = "`"

# ترتيب التحميل نفسه في cloud/main.js — المُشغّلات قبل الدوال.
CLOUD_FILES = [
    "cloud/main.js",
    "cloud/triggers.js",
    "cloud/lib/errors.js",
    "cloud/lib/auth.js",
    "cloud/lib/push.js",
    "cloud/lib/payments.js",
    "cloud/lib/audit.js",
    "cloud/functions/mosques.js",
    "cloud/functions/requests.js",
    "cloud/functions/donations.js",
    "cloud/functions/users.js",
    "cloud/functions/maintenance.js",
]

TEST_FILES = [
    ("tests/helpers/parse-mock.js", "بديل Parse — مخزن في الذاكرة بلا خادم"),
    ("tests/donations.test.js", "المسار المالي: التأكيد والحجز"),
    ("tests/triggers.test.js", "حماية الأدوار وإقفال الحساب على صاحبه"),
    ("tests/requests.test.js", "دورة حياة الطلب والإلغاء والصرف"),
    ("tests/audit.test.js", "سجل التدقيق والمهمة الدورية"),
    ("tests/users.test.js", "الحسابات والاسترداد والبحث"),
    ("tests/schema.test.js", "الصلاحيات وتطابق النسختين"),
    ("tests/integration/harness.js", "تشغيل parse-server حقيقي فوق PostgreSQL"),
    ("tests/integration/flow.test.js", "الرحلة الكاملة على خادم حقيقي"),
]

HEADER = """# مسجدي (Masjidi) — الملف الهندسي الكامل

**الإصدار:** 1.0.0
**آخر تحديث:** أغسطس 2026

منصة تربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة والمتبرعين،
لإدارة أعمال الصيانة بشفافية. Backend على Parse Server (Back4app)، مهيّأ مسبقاً
بـ **18,214 مسجداً** من البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية.

> **هذا الملف يحتوي المشروع كاملاً** — السياق، المراجعة، المخطط، كل كود السحابة
> (مجزّأً ومدمجاً)، وكل السكربتات بما فيها مولّدا هذا الملف نفسه، فيمكن للملف أن
> يُعيد إنتاج نفسه. المستثنى ملفّا البيانات المولّدان وحدهما:
> `data/mosques.json` (11 ميغابايت، 18 ألف سجل) و`data/mosques.sample.json` —
> كلاهما يُولَّد من سكربت التنظيف في القسم 9.

## كيف تستخدمه

**مع Claude Code:** ضع هذا الملف في مجلد فارغ باسم `CLAUDE.md`، شغّل `claude`،
واطلب منه تفكيكه إلى البنية الموصوفة في القسم 3. استخدم **القسم 6أ** — وهو
الملفات كما هي على القرص بكامل `require` و`module.exports`. لا تُفكّك القسم 6ب.

**يدوياً:** انسخ كود **القسم 6ب** (الملف المدمج) إلى `main.js` في لوحة Back4app
والصقه مباشرة.

---

## الفهرس

| # | القسم |
|---|---|
| 1 | [الحالة والقيود](#1-الحالة-والقيود) |
| 2 | [قواعد العمل](#2-قواعد-العمل) |
| 3 | [البنية](#3-البنية) |
| 4 | [مراجعة الكود الأصلي — ثغرات حرجة](#4-مراجعة-الكود-الأصلي) |
| 5 | [مخطط قاعدة البيانات](#5-مخطط-قاعدة-البيانات) |
| 6 | [كود السحابة كاملاً — مجزّأً (6أ) ومدمجاً (6ب)](#6-كود-السحابة-كاملاً) |
| 7 | [دورة حياة الطلب والدوال وقواعد الأمن](#7-دورة-حياة-الطلب-والدوال-وقواعد-الأمن) |
| 8 | [البيانات](#8-البيانات) |
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) — و[الاختبارات](#9ب-الاختبارات) |
| 10 | [خطة التشغيل](#10-خطة-التشغيل) |

---
"""


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8").strip()


def fence(text, lang=""):
    """
    يُحيط النص بسياج أطول من أطول سلسلة علامات اقتباس خلفية داخله.

    يلزم لأن القسم 9 يُضمّن هذا السكربت في نفسه: لو كان السياج ثابتاً بثلاث
    علامات لأغلقه أول سياج داخل النص وانكسر الملف عند أول إعادة توليد.
    """
    longest = max((len(run) for run in re.findall(BT + "+", text)), default=0)
    bar = BT * max(3, longest + 1)
    return f"{bar}{lang}\n{text}\n{bar}"


def block(rel, lang):
    """كتلة كود لملف على القرص، معنونة بمساره."""
    return f"#### `{rel}`\n\n" + fence(read(rel), lang)


def strip_h1(text):
    lines = text.split("\n")
    if lines[0].startswith("# "):
        lines = lines[1:]
    return "\n".join(lines).strip()


def demote(text, levels=1):
    """خفض مستوى العناوين لتندرج تحت أقسام هذا الملف."""
    out = []
    for line in text.split("\n"):
        if line.startswith("#"):
            out.append("#" * levels + line)
        else:
            out.append(line)
    return "\n".join(out)


sections = []

# 1
sections.append("## 1. الحالة والقيود\n\n" + demote(strip_h1(read("CLAUDE.md")).split("## البنية")[0].split("## ما هو المشروع")[1].strip()))

# 2
claude_md = read("CLAUDE.md")
rules = claude_md.split("## قواعد العمل في هذا المستودع")[1].split("## القيود المهمة")[0].strip()
constraints = claude_md.split("## القيود المهمة")[1].split("## الخطوات التالية")[0].strip()
sections.append("## 2. قواعد العمل\n\n" + rules + "\n\n### القيود المهمة\n\n" + constraints)

# 3
structure = claude_md.split("## البنية")[1].split("## قواعد العمل")[0].strip()
sections.append("## 3. البنية\n\n" + structure)

# 4
sections.append("## 4. مراجعة الكود الأصلي\n\n" + demote(strip_h1(read("docs/REVIEW.md"))))

# 5
sections.append("## 5. مخطط قاعدة البيانات\n\nاحفظه في `cloud/schema.json` وطبّقه عبر السكربت في القسم 9.\n\n"
                + fence(read("cloud/schema.json"), "json"))

# 6
# المجزّأة أولاً: هي وحدها القابلة لإعادة بناء المستودع، لأن المدمجة تُحذف منها
# أسطر require/module.exports فلا تعمل قطعها كوحدات منفصلة.
sections.append(
    "## 6. كود السحابة كاملاً\n\n"
    "### 6أ — النسخة المجزّأة (لإعادة بناء المستودع)\n\n"
    "الملفات كما هي على القرص، بكامل `require` و`module.exports`. هذه هي النسخة\n"
    "التي تُفكَّك إلى البنية الموصوفة في القسم 3. المخطط `cloud/schema.json` في\n"
    "القسم 5.\n\n"
    + "\n\n".join(block(rel, "javascript") for rel in CLOUD_FILES)
    + "\n\n### 6ب — النسخة المدمجة (للصق في Back4app)\n\n"
      "مولّدة آلياً من ملفات القسم 6أ عبر `scripts/build_single_file.py`، وقد حُذفت\n"
      "منها أسطر `require` و`module.exports` لتعمل كملف واحد. **لا تُفكّك هذه النسخة**\n"
      "— قطعها بلا استيراد ولا تصدير ولن تُحمَّل كوحدات منفصلة؛ استخدم القسم 6أ.\n\n"
      "الصقها في `main.js` داخل Back4app → Cloud Code → Deploy.\n\n"
    + fence(read("cloud/main.bundle.js"), "javascript")
)

# 7
spec = read("docs/PROJECT_SPEC.md")
lifecycle = spec.split("## 5. دورة حياة الطلب")[1].split("## 9. خطة الإطلاق")[0].strip()
for src, dst in (
    ("## 6. دوال السحابة", "### دوال السحابة"),
    ("## 7. قواعد الأمن", "### قواعد الأمن"),
    ('## 8. تكامل منصة "أيادي" (مستقبلاً)', '### تكامل منصة "أيادي" (مستقبلاً)'),
):
    lifecycle = lifecycle.replace(src, dst)
roles = spec.split("## 3. الأدوار")[1].split("## 4. مخطط")[0].strip()
sections.append("## 7. دورة حياة الطلب والدوال وقواعد الأمن\n\n### الأدوار\n" + roles
                + "\n\n### دورة الحياة\n" + lifecycle)

# 8
sections.append("## 8. البيانات\n\n" + demote(strip_h1(read("docs/DATA.md"))))

# 9
sections.append("## 9. سكربتات التجهيز\n\n"
                "### `scripts/clean_mosques.py` — تنظيف ملف الوزارة\n\n"
                + fence(read("scripts/clean_mosques.py"), "python") + "\n\n"
                "### `scripts/apply_schema.js` — تطبيق المخطط\n\n"
                + fence(read("scripts/apply_schema.js"), "javascript") + "\n\n"
                "### `scripts/seed_mosques.js` — استيراد 18 ألف مسجد\n\n"
                + fence(read("scripts/seed_mosques.js"), "javascript") + "\n\n"
                "### `scripts/build_single_file.py` — توليد النسخة المدمجة (القسم 6ب)\n\n"
                + fence(read("scripts/build_single_file.py"), "python") + "\n\n"
                "### `scripts/build_single_doc.py` — توليد هذا الملف\n\n"
                + fence(read("scripts/build_single_doc.py"), "python") + "\n\n"
                "### `.env.example`\n\n" + fence(read(".env.example"), "bash") + "\n\n"
                "### `.gitignore`\n\n" + fence(read(".gitignore"), "gitignore") + "\n\n"
                "### `package.json`\n\n" + fence(read("package.json"), "json") + "\n\n"
                "## 9ب. الاختبارات\n\n"
                "`npm test` — تعمل على بديل Parse في الذاكرة، بلا خادم ولا مفاتيح.\n"
                "ترصد أخطاء المنطق لا أخطاء المنصّة؛ ما يخرج عن تغطيتها مذكور في\n"
                "«ما لم يُعالَج» بالقسم 4.\n\n"
                + "\n\n".join(
                    f"#### `{rel}` — {note}\n\n" + fence(read(rel), "javascript")
                    for rel, note in TEST_FILES))

# 10
readme = read("README.md")
steps = readme.split("## البدء")[1].split("## قبل أي تعديل")[0].strip()
launch = spec.split("## 9. خطة الإطلاق")[1].strip()
sections.append("## 10. خطة التشغيل\n\n" + steps + "\n\n### مراحل الإطلاق\n\n" + launch)

OUT.write_text(HEADER + "\n" + "\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
print(f"✓ {OUT}  ({len(OUT.read_text(encoding='utf-8').splitlines())} سطراً، "
      f"{OUT.stat().st_size // 1024} كيلوبايت)")
```

### `.env.example`

```bash
# Parse / Back4app
PARSE_APP_ID=
PARSE_JS_KEY=
PARSE_MASTER_KEY=
PARSE_SERVER_URL=https://parseapi.back4app.com

# بوابة الدفع — ثواني (اتركها فارغة في مرحلة الـ MVP التطوّعي)
THAWANI_BASE_URL=https://uatcheckout.thawani.om/api/v1
THAWANI_SECRET_KEY=
THAWANI_PUBLISHABLE_KEY=
PAYMENT_SUCCESS_URL=masjidi://payment/success
PAYMENT_CANCEL_URL=masjidi://payment/cancel
# سرّ نقطة نهاية البوابة — يُسجَّل في لوحة ثواني ويُولَّد عشوائياً
PAYMENT_WEBHOOK_SECRET=

# منصة أيادي (مستقبلاً)
AYADI_API_KEY=
```

### `.gitignore`

```gitignore
node_modules/
.env
*.log
.DS_Store
data/*.xlsx
logs/
```

### `package.json`

```json
{
  "name": "masjidi",
  "version": "1.0.0",
  "description": "منصة لربط الأئمة والمتطوعين والشركات لصيانة مساجد سلطنة عُمان",
  "private": true,
  "scripts": {
    "clean:data": "python3 scripts/clean_mosques.py \"$npm_config_src\"",
    "seed": "node scripts/seed_mosques.js",
    "seed:dry": "node scripts/seed_mosques.js --dry-run",
    "schema": "node scripts/apply_schema.js",
    "test": "node --test tests/*.test.js",
    "lint": "eslint cloud scripts tests --ext .js",
    "test:integration": "node --test tests/integration/*.test.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "parse": "^5.3.0"
  },
  "devDependencies": {
    "eslint": "^8.57.0",
    "express": "^4.21.2",
    "parse-server": "^9.10.0",
    "pg": "^8.13.1"
  },
  "engines": {
    "node": ">=18"
  }
}
```

## 9ب. الاختبارات

`npm test` — تعمل على بديل Parse في الذاكرة، بلا خادم ولا مفاتيح.
ترصد أخطاء المنطق لا أخطاء المنصّة؛ ما يخرج عن تغطيتها مذكور في
«ما لم يُعالَج» بالقسم 4.

#### `tests/helpers/parse-mock.js` — بديل Parse — مخزن في الذاكرة بلا خادم

```javascript
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
    return actual === expected;
  };

  class MockQuery {
    constructor(target) {
      this.className = classNameOf(target);
      this._equal = [];
      this._greater = [];
      this._less = [];
      this._contained = [];
      this._prefix = [];
      this._substring = [];
    }

    equalTo(key, value) { this._equal.push([key, value]); return this; }
    greaterThan(key, value) { this._greater.push([key, value]); return this; }
    lessThan(key, value) { this._less.push([key, value]); return this; }
    containedIn(key, values) { this._contained.push([key, values]); return this; }
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
        this._contained.every(([k, values]) => values.includes(object.get(k))) &&
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
```

#### `tests/donations.test.js` — المسار المالي: التأكيد والحجز

```javascript
/**
 * المسار المالي: تأكيد التبرّع وحجز نيّات التبرّع.
 *
 * كل حالة هنا تُقابل ثغرة أُصلحت — راجع `docs/REVIEW.md` قبل تعديل أي توقُّع.
 * الاختبارات تُشغَّل على النسختين المجزّأة والمدمجة، فأي انحراف بينهما يظهر هنا.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud, ENTRIES } = require('./helpers/parse-mock');

const OMR = (baisa) => baisa * 1000;

for (const entry of Object.keys(ENTRIES)) {
  test(`التبرعات — النسخة ${entry}`, async (t) => {
    let api;
    let donor;
    let attacker;
    let mosque;

    t.beforeEach(() => {
      api = loadCloud(entry);
      donor = api.asUser('user_donor');
      attacker = api.asUser('user_attacker');
      mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    });

    /** طلب صيانة مموّل بتكلفة 500 ريال، بلا تمويل بعد. */
    const openRequest = () => api.make('ServiceRequests', {
      mosqueId: mosque,
      title: 'إصلاح المكيّف',
      estimatedCost: 500,
      fundedAmount: 0,
      status: 'pending_funding',
    });

    const pendingDonation = (serviceRequest, amount = 500, ageMinutes = 0) =>
      api.make('Transactions', {
        donorId: donor,
        mosqueId: mosque,
        requestId: serviceRequest,
        amount,
        type: 'donation',
        status: 'pending',
        paymentSessionId: 'sess_test',
      }, new Date(Date.now() - ageMinutes * 60 * 1000));

    await t.test('لا يؤكّد المعاملةَ إلا صاحبها', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'unpaid';

      const { error } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: attacker });

      assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
      assert.equal(transaction.get('status'), 'pending',
        'محاولة الغريب يجب ألا تمسّ حالة المعاملة');
    });

    await t.test('الجلسة المفتوحة تبقى pending فلا يضيع الدفع اللاحق', async () => {
      const serviceRequest = openRequest();
      const transaction = pendingDonation(serviceRequest);

      // يعود المتبرّع قبل أن يُتمّ الدفع
      api.gateway.status = 'unpaid';
      const early = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(early.ok.status, 'pending');
      assert.equal(transaction.get('status'), 'pending',
        'تعليمها failed هنا يُسقطها من شرط pending فيضيع المبلغ');

      // ثم يدفع فعلاً ويعود
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);
      const settled = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(settled.ok.status, 'captured');
      assert.equal(mosque.get('walletBalance'), 500);
      assert.equal(serviceRequest.get('status'), 'funded');
    });

    await t.test('الجلسة الملغاة وحدها تُعلَّم failed', async () => {
      const transaction = pendingDonation(openRequest(), 100);
      api.gateway.status = 'cancelled';

      const { ok } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(ok.status, 'failed');
      assert.equal(transaction.get('status'), 'failed');
    });

    await t.test('استدعاء webhook بـ Master Key يمرّ بلا مستخدم', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);

      const { ok } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { master: true });

      assert.equal(ok.status, 'captured');
    });

    await t.test('التأكيد المكرَّر لا يضاعف الرصيد', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(500);

      await api.call('confirmDonation', { transactionId: transaction.id }, { user: donor });
      const again = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(again.ok.status, 'captured');
      assert.equal(mosque.get('walletBalance'), 500, 'قُيّد المبلغ مرتين');
    });

    await t.test('مبلغ البوابة المخالف يُرفض ويُعلَّم mismatch', async () => {
      const transaction = pendingDonation(openRequest());
      api.gateway.status = 'paid';
      api.gateway.amountBaisa = OMR(5); // دُفع 5 بدل 500

      const { error } = await api.call('confirmDonation',
        { transactionId: transaction.id }, { user: donor });

      assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
      assert.equal(transaction.get('status'), 'mismatch');
      assert.equal(mosque.get('walletBalance'), 0);
    });

    await t.test('نيّة التبرّع المعلّقة تحجز المبلغ فيُمنع التمويل الزائد', async () => {
      const serviceRequest = openRequest();

      const first = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: donor });
      assert.ok(first.ok, 'المتبرّع الأول يجب أن يُقبل');

      const second = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: attacker });

      assert.equal(second.error.code, api.ParseError.VALIDATION_ERROR,
        'بلا حجز يدفع الاثنان فتُقبض 1000 ريال لطلب تكلفته 500');
    });

    await t.test('الحجز المهجور يسقط بعد المهلة', async () => {
      const serviceRequest = openRequest();
      pendingDonation(serviceRequest, 500, 31); // معلّقة منذ 31 دقيقة

      const { ok } = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 500 }, { user: donor });

      assert.ok(ok, 'متبرّع لم يُكمل الدفع يجب ألا يُعطّل الطلب إلى الأبد');
    });

    await t.test('الحجز الجزئي يترك الباقي متاحاً', async () => {
      const serviceRequest = openRequest();
      pendingDonation(serviceRequest, 200);

      const fits = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 300 }, { user: attacker });
      assert.ok(fits.ok, 'المتبقي 300 ريال فيجب أن يُقبل');

      const overflows = await api.call('initiateDonation',
        { requestId: serviceRequest.id, amount: 1 }, { user: attacker });
      assert.ok(overflows.error, 'لم يبقَ شيء بعد الحجزين');
    });
  });
}
```

#### `tests/triggers.test.js` — حماية الأدوار وإقفال الحساب على صاحبه

```javascript
/**
 * المُشغّلات: حماية الأدوار وإقفال حساب المستخدم على نفسه.
 *
 * `save` في البديل لا تُشغّل المُشغّلات تلقائياً، فتُستدعى هنا مباشرةً بطلب
 * مُركَّب — وهو ما تفعله Parse فعلياً قبل الكتابة وبعدها.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('المُشغّلات', async (t) => {
  let api;

  t.beforeEach(() => { api = loadCloud('modular'); });

  /** كائن مستخدم كما يصل إلى beforeSave. */
  const newUser = (attributes = {}) => {
    const user = api.make('_User', attributes);
    user._new = true;
    for (const key of Object.keys(attributes)) user._dirty.add(key);
    return user;
  };

  await t.test('المستخدم لا يرقّي نفسه إلى admin', async () => {
    const user = newUser({ role: 'admin' });
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: user, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('الإدارة ترقّي بـ Master Key', async () => {
    const user = newUser({ role: 'admin' });
    await api.trigger('beforeSave:_User', { object: user, master: true });
    assert.equal(user.get('role'), 'admin');
  });

  await t.test('المستخدم لا يعتمد نفسه شركةً معتمدة', async () => {
    const existing = api.make('_User', { role: 'contractor', isVerifiedContractor: false });
    existing.set('isVerifiedContractor', true);
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: existing, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  // رُصد على خادم حقيقي: `isVerifiedContractor` له `defaultValue` في المخطط،
  // فيطبّقه Parse عند الإنشاء ويُعلّم الحقل مُعدَّلاً. حارسٌ يعتمد `dirty()`
  // وحده كان يرفض **كل تسجيل جديد**. البديل في الذاكرة لا يطبّق القيم
  // الافتراضية، فتُحاكى هنا بتعليم الحقل صراحةً على مستخدم جديد.
  await t.test('القيمة الافتراضية في المخطط لا تمنع التسجيل', async () => {
    const signup = newUser({ role: 'imam', isVerifiedContractor: false });

    await api.trigger('beforeSave:_User', { object: signup, master: false });

    assert.equal(signup.get('role'), 'imam');
    assert.equal(signup.get('isVerifiedContractor'), false);
  });

  await t.test('التسجيل بادّعاء الاعتماد يُخفَّض بلا رفض', async () => {
    const signup = newUser({ role: 'contractor', isVerifiedContractor: true });

    await api.trigger('beforeSave:_User', { object: signup, master: false });

    assert.equal(signup.get('isVerifiedContractor'), false,
      'الحساب الجديد يبدأ غير معتمد دائماً');
  });

  await t.test('الدور يُختار عند التسجيل ثم يُثبَّت', async () => {
    const signup = newUser({ role: 'imam' });
    await api.trigger('beforeSave:_User', { object: signup, master: false });
    assert.equal(signup.get('role'), 'imam', 'الاختيار عند التسجيل مسموح');

    const existing = api.make('_User', { role: 'donor' });
    existing.set('role', 'imam'); // متبرّع يرقّي نفسه إماماً لاحقاً
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: existing, master: false }),
      (error) => error.code === api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('الدور المجهول يُرفض', async () => {
    const user = newUser({ role: 'superuser' });
    await assert.rejects(
      () => api.trigger('beforeSave:_User', { object: user, master: false }),
      (error) => error.code === api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الدور الافتراضي donor عند التسجيل', async () => {
    const user = newUser();
    await api.trigger('beforeSave:_User', { object: user, master: false });
    assert.equal(user.get('role'), 'donor');
    assert.equal(user.get('isActive'), true);
  });

  await t.test('حساب جديد يُقفل على صاحبه', async () => {
    const user = api.make('_User', { phone: '9xxxxxxx' });

    // بلا ACL: الافتراض قراءة عامة تكشف الهاتف وموقع المتطوع
    await api.trigger('afterSave:_User', { object: user, original: undefined });

    const acl = user.getACL();
    assert.ok(acl, 'لم يُضبط ACL');
    assert.equal(acl.getPublicReadAccess(), false);
    assert.equal(acl.getPublicWriteAccess(), false);
    assert.equal(acl.getReadAccess(user.id), true);
    assert.equal(acl.getWriteAccess(user.id), true);
  });

  await t.test('التحديث لا يُعيد ضبط ACL — وهو ما يمنع الحلقة اللانهائية', async () => {
    const user = api.make('_User', {});
    const marker = new Parse.ACL();
    marker.setReadAccess('someone_else', true);
    user.setACL(marker);

    await api.trigger('afterSave:_User', { object: user, original: user });

    assert.equal(user.getACL(), marker, 'لُمس ACL في مسار التحديث');
  });

  await t.test('الرصيد السالب مرفوض', async () => {
    const mosque = api.make('Mosques', { walletBalance: -1 });
    await assert.rejects(
      () => api.trigger('beforeSave:Mosques', { object: mosque, master: true }),
      (error) => error.code === api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الطلبات والمعاملات لا تُكتب من العميل', async () => {
    for (const className of ['ServiceRequests', 'Transactions']) {
      await assert.rejects(
        () => api.trigger(`beforeSave:${className}`,
          { object: api.make(className, {}), master: false }),
        (error) => error.code === api.ParseError.OPERATION_FORBIDDEN,
        `${className} مفتوحة للكتابة من العميل`);
    }
  });
});
```

#### `tests/requests.test.js` — دورة حياة الطلب والإلغاء والصرف

```javascript
/**
 * دورة حياة طلب الصيانة: الإنشاء، الإلغاء، الاعتماد، والصرف.
 *
 * كل حالة هنا تُقابل بنداً كان في «ما لم يُعالَج» بـ`docs/REVIEW.md`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('طلبات الصيانة', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    volunteer = api.asUser('user_volunteer', 'volunteer');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0, isClaimed: true, imamId: imam });
  });

  const requestAt = (status, extra = {}) => api.make('ServiceRequests', {
    mosqueId: mosque,
    title: 'إصلاح المكيّف',
    estimatedCost: 0,
    fundedAmount: 0,
    status,
    ...extra,
  });

  await t.test('التكلفة غير الرقمية تُرفض بدل أن تصير طلباً تطوّعياً', async () => {
    const { error } = await api.call('createServiceRequest',
      { title: 'إصلاح', description: 'وصف كافٍ للطلب', estimatedCost: 'كثير' },
      { user: imam });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR,
      '`Number(x) || 0` كان يبتلع NaN فيُنشئ طلباً بتكلفة صفر');
  });

  await t.test('غياب التكلفة يعني طلباً تطوّعياً', async () => {
    const { ok } = await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    assert.equal(ok.estimatedCost, 0);
    assert.equal(ok.status, 'open_for_volunteers');
  });

  await t.test('لا يُلغى الطلب بعد بدء التنفيذ', async () => {
    for (const status of ['in_progress', 'pending_imam_approval']) {
      const serviceRequest = requestAt(status, { assignedVolunteerId: volunteer });
      const { error } = await api.call('cancelServiceRequest',
        { requestId: serviceRequest.id }, { user: imam });

      assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN, `أُلغي وهو ${status}`);
      assert.equal(serviceRequest.get('status'), status);
    }
  });

  await t.test('الإلغاء قبل التنفيذ يمرّ ويُشعر المكلَّف', async () => {
    const serviceRequest = requestAt('assigned', { assignedVolunteerId: volunteer });
    const { ok } = await api.call('cancelServiceRequest',
      { requestId: serviceRequest.id }, { user: imam });

    assert.equal(ok.status, 'cancelled');
    assert.equal(api.pushes.length, 1, 'المتطوّع قد يكون في طريقه إلى المسجد');
    assert.equal(api.pushes[0].users[0].id, volunteer.id);
  });

  await t.test('الاعتماد يُحدّث تقييم المنفّذ وعدد أعماله', async () => {
    const worker = api.make('_User', { role: 'volunteer', completedJobs: 0 });
    const serviceRequest = requestAt('pending_imam_approval', { assignedVolunteerId: worker });

    await api.call('completeService', { requestId: serviceRequest.id, rating: 4 }, { user: imam });

    assert.equal(worker.get('completedJobs'), 1);
    assert.equal(worker.get('avgRating'), 4);

    const second = requestAt('pending_imam_approval', { assignedVolunteerId: worker });
    await api.call('completeService', { requestId: second.id, rating: 2 }, { user: imam });

    assert.equal(worker.get('completedJobs'), 2);
    assert.equal(worker.get('avgRating'), 3, 'المتوسط التراكمي (4+2)/2');
  });

  // رُصد على خادم حقيقي: الاستعلام الجغرافي فشل (لا فهرس)، فأسقط إنشاء الطلب
  // بعد أن كان الطلب قد حُفظ فعلاً — فيرى الإمام خطأً ويُعيد المحاولة فيُكرّر.
  await t.test('فشل جلب المتطوّعين القريبين لا يُسقط إنشاء الطلب', async () => {
    const original = Parse.Query.prototype.find;
    Parse.Query.prototype.find = async function patched() {
      if (this.className === '_User') throw new Error('لا يوجد فهرس 2dsphere');
      return original.call(this);
    };

    try {
      const { ok, error } = await api.call('createServiceRequest',
        { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

      assert.equal(error, undefined, error && error.message);
      assert.equal(ok.status, 'open_for_volunteers');
    } finally {
      Parse.Query.prototype.find = original;
    }
  });

  await t.test('فشل إرسال الإشعار نفسه لا يُسقط العملية', async () => {
    const original = Parse.Push.send;
    Parse.Push.send = async () => { throw new Error('تعذّر الإرسال'); };

    try {
      const serviceRequest = requestAt('assigned', { assignedVolunteerId: volunteer });
      const { ok } = await api.call('cancelServiceRequest',
        { requestId: serviceRequest.id }, { user: imam });

      assert.equal(ok.status, 'cancelled');
    } finally {
      Parse.Push.send = original;
    }
  });

  await t.test('الصرف لا يتجاوز الرصيد ولو تزامن', async () => {
    const admin = api.asUser('user_admin', 'admin');
    mosque.set('walletBalance', 500);

    const first = requestAt('completed', { estimatedCost: 500 });
    const second = requestAt('completed', { estimatedCost: 500 });

    // صرفان متزامنان على مسجد رصيده يكفي واحداً منهما فقط
    const [a, b] = await Promise.all([
      api.call('payoutContractor', { requestId: first.id, amount: 500 }, { user: admin }),
      api.call('payoutContractor', { requestId: second.id, amount: 500 }, { user: admin }),
    ]);

    const succeeded = [a, b].filter((r) => r.ok).length;
    assert.equal(succeeded, 1, 'نجح الصرفان معاً — الرصيد صار سالباً');
    assert.equal(mosque.get('walletBalance'), 0, 'التعويض لم يُعِد المبلغ المرفوض');
  });

  await t.test('الصرف المكرَّر لنفس الطلب مرفوض', async () => {
    const admin = api.asUser('user_admin', 'admin');
    mosque.set('walletBalance', 1000);
    const serviceRequest = requestAt('completed', { estimatedCost: 500 });

    await api.call('payoutContractor', { requestId: serviceRequest.id, amount: 500 }, { user: admin });
    const again = await api.call('payoutContractor',
      { requestId: serviceRequest.id, amount: 500 }, { user: admin });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
    assert.equal(mosque.get('walletBalance'), 500);
  });
});

test('طلبات ملكية المسجد', async (t) => {
  let api;
  let imam;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
  });

  await t.test('الإمام يرى حالة طلبه', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان', wilayat: 'العامرات' });
    api.make('MosqueClaims', { imamId: imam, mosqueId: mosque, status: 'pending', evidenceNote: 'إفادة' });

    const { ok } = await api.call('getMyClaims', {}, { user: imam });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].status, 'pending');
    assert.equal(ok[0].mosqueName, 'جامع السلطان',
      'MosqueClaims مقفلة على Master Key فلا سبيل آخر للإمام لمعرفة الحالة');
  });

  await t.test('لا يرى طلبات غيره', async () => {
    const other = api.asUser('user_other_imam', 'imam');
    const mosque = api.make('Mosques', { name: 'مسجد آخر' });
    api.make('MosqueClaims', { imamId: other, mosqueId: mosque, status: 'approved' });

    const { ok } = await api.call('getMyClaims', {}, { user: imam });
    assert.equal(ok.length, 0);
  });
});

test('اهتمام المتطوّعين', async (t) => {
  let api;
  let imam;
  let volunteer;
  let mosque;
  let openRequest;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    volunteer = api.make('_User', { role: 'volunteer', fullName: 'سالم', skills: ['كهرباء'], completedJobs: 3, avgRating: 4.5 });
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', isClaimed: true, imamId: imam });
    openRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'تصليح إنارة', estimatedCost: 0, status: 'open_for_volunteers' });
  });

  await t.test('المتطوّع يُسجّل اهتمامه بلا أن يُسند الطلب لنفسه', async () => {
    const { ok } = await api.call('expressInterest',
      { requestId: openRequest.id, note: 'أستطيع الجمعة' }, { user: volunteer });

    assert.ok(ok.interestId);
    assert.equal(openRequest.get('status'), 'open_for_volunteers',
      'الاهتمام لا يُغيّر الحالة — الإمام هو من يعيّن');
    assert.equal(openRequest.get('assignedVolunteerId'), undefined);
    assert.equal(api.pushes.at(-1).users[0].id, imam.id, 'يجب إشعار الإمام');
  });

  await t.test('لا يُسجَّل اهتمامان لنفس المتطوّع', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    const again = await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
  });

  await t.test('الطلب المموّل لا يستقبل اهتماماً', async () => {
    const funded = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'ترميم', estimatedCost: 500, status: 'pending_funding' });

    const { error } = await api.call('expressInterest', { requestId: funded.id }, { user: volunteer });
    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
  });

  await t.test('الإمام يرى المهتمّين بمهاراتهم وتقييمهم لا بهواتفهم', async () => {
    await api.call('expressInterest',
      { requestId: openRequest.id, note: 'أستطيع الجمعة' }, { user: volunteer });

    const { ok } = await api.call('getRequestInterests', { requestId: openRequest.id }, { user: imam });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].fullName, 'سالم');
    assert.deepEqual(ok[0].skills, ['كهرباء']);
    assert.equal(ok[0].avgRating, 4.5);
    assert.equal(ok[0].note, 'أستطيع الجمعة');
    assert.equal(ok[0].phone, undefined, 'الهاتف لا يُكشف قبل التكليف');
  });

  await t.test('إمام مسجد آخر لا يرى المهتمّين', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    const stranger = api.asUser('other_imam', 'imam');

    const { error } = await api.call('getRequestInterests',
      { requestId: openRequest.id }, { user: stranger });

    assert.ok(error, 'كُشفت قائمة مهتمّين لمسجد غير مسجّل باسمه');
  });

  await t.test('السحب يُخرج المتطوّع من القائمة', async () => {
    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    await api.call('withdrawInterest', { requestId: openRequest.id }, { user: volunteer });

    const { ok } = await api.call('getRequestInterests', { requestId: openRequest.id }, { user: imam });
    assert.equal(ok.length, 0);
  });

  await t.test('التكليف يُقفل الاهتمامات المعلّقة', async () => {
    const other = api.make('_User', { role: 'volunteer', fullName: 'خالد' });

    await api.call('expressInterest', { requestId: openRequest.id }, { user: volunteer });
    await api.call('expressInterest', { requestId: openRequest.id }, { user: other });

    await api.call('assignWorker',
      { requestId: openRequest.id, workerId: volunteer.id }, { user: imam });

    const remaining = api.store.TaskInterests.filter((i) => i.get('status') === 'active');
    assert.equal(remaining.length, 0, 'من لم يُختَر يبقى معروضاً كأنه بالانتظار');
  });
});
```

#### `tests/audit.test.js` — سجل التدقيق والمهمة الدورية

```javascript
/**
 * سجل التدقيق والمهمة الدورية لمراجعة المعاملات المعلّقة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

const OMR = (baisa) => baisa * 1000;

test('سجل التدقيق', async (t) => {
  let api;
  let imam;
  let mosque;

  t.beforeEach(() => {
    api = loadCloud('modular');
    imam = api.asUser('user_imam', 'imam');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0, isClaimed: true, imamId: imam });
  });

  const trail = () => api.store.AuditLog || [];

  await t.test('إنشاء الطلب يُقيَّد', async () => {
    await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    assert.equal(trail().length, 1);
    assert.equal(trail()[0].get('action'), 'request_created');
    assert.equal(trail()[0].get('actorRole'), 'imam');
    assert.equal(trail()[0].get('toStatus'), 'open_for_volunteers');
  });

  await t.test('الإلغاء يُقيَّد بحالته السابقة', async () => {
    const serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', status: 'assigned', fundedAmount: 0 });

    await api.call('cancelServiceRequest', { requestId: serviceRequest.id }, { user: imam });

    const entry = trail().find((e) => e.get('action') === 'request_cancelled');
    assert.ok(entry, 'لم يُقيَّد الإلغاء');
    assert.equal(entry.get('fromStatus'), 'assigned');
    assert.equal(entry.get('toStatus'), 'cancelled');
  });

  await t.test('السجل المعروض يُظهر الدور لا هوية الفاعل', async () => {
    await api.call('createServiceRequest',
      { title: 'تنظيف', description: 'تنظيف السجاد قبل الجمعة' }, { user: imam });

    const { ok } = await api.call('getMosqueAuditTrail',
      { mosqueId: mosque.id }, { user: api.asUser('any_donor') });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].actorRole, 'imam');
    assert.equal(ok[0].actorId, undefined, 'هوية الفاعل يجب ألا تُعاد');
  });

  await t.test('فشل القيد لا يُسقط العملية التي يوثّقها', async () => {
    // اعتماد عمل منجَز يجب ألا يفشل لأن سطر تدقيق لم يُكتب
    const original = Parse.Object.extend;
    Parse.Object.extend = (className) => {
      if (className === 'AuditLog') {
        return class { set() { return this; } async save() { throw new Error('تعذّرت الكتابة'); } };
      }
      return original(className);
    };

    try {
      const serviceRequest = api.make('ServiceRequests',
        { mosqueId: mosque, title: 'إصلاح', status: 'pending_imam_approval' });
      const { ok } = await api.call('completeService',
        { requestId: serviceRequest.id, rating: 5 }, { user: imam });

      assert.equal(ok.status, 'completed');
      assert.equal(serviceRequest.get('status'), 'completed');
    } finally {
      Parse.Object.extend = original;
    }
  });
});

test('مراجعة المعاملات المعلّقة', async (t) => {
  let api;
  let mosque;
  let serviceRequest;

  t.beforeEach(() => {
    api = loadCloud('modular');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', estimatedCost: 500, fundedAmount: 0, status: 'pending_funding' });
  });

  const stalePending = (ageMinutes) => api.make('Transactions', {
    donorId: api.asUser('user_donor'),
    mosqueId: mosque,
    requestId: serviceRequest,
    amount: 500,
    type: 'donation',
    status: 'pending',
    paymentSessionId: 'sess_stale',
  }, new Date(Date.now() - ageMinutes * 60 * 1000));

  await t.test('الدفع الذي لم يعد صاحبه لتأكيده يُقيَّد', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { result } = await api.runJob('reviewPendingDonations');

    assert.match(result, /قُيّدت 1/);
    assert.equal(transaction.get('status'), 'captured');
    assert.equal(mosque.get('walletBalance'), 500, 'أُغلق المسار الذي يُبقي المال معلّقاً');
    assert.equal(serviceRequest.get('status'), 'funded');
  });

  await t.test('الجلسة الملغاة تُعلَّم failed', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'cancelled';

    await api.runJob('reviewPendingDonations');
    assert.equal(transaction.get('status'), 'failed');
  });

  await t.test('الجلسة المفتوحة تُترك حتى المهلة القصوى', async () => {
    const recent = stalePending(45);
    api.gateway.status = 'unpaid';

    await api.runJob('reviewPendingDonations');
    assert.equal(recent.get('status'), 'pending', 'لم تتجاوز 24 ساعة بعد');

    const ancient = stalePending(25 * 60);
    await api.runJob('reviewPendingDonations');
    assert.equal(ancient.get('status'), 'expired');
  });

  await t.test('المبلغ المخالف لا يُقيَّد', async () => {
    const transaction = stalePending(45);
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(5); // دُفع 5 بدل 500

    await api.runJob('reviewPendingDonations');

    assert.equal(transaction.get('status'), 'mismatch');
    assert.equal(mosque.get('walletBalance'), 0);
  });

  await t.test('المعاملات الحديثة لا تُمسّ', async () => {
    const fresh = stalePending(5); // ما تزال ضمن مهلة الحجز
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { result } = await api.runJob('reviewPendingDonations');

    assert.match(result, /فُحصت 0/);
    assert.equal(fresh.get('status'), 'pending');
  });

  // المرحلة الأولى تُطلق بلا بوابة دفع، والمهمة مجدوَلة على أي حال
  await t.test('بلا مفاتيح بوابة تتخطّى المهمة بلا خطأ', async () => {
    const unconfigured = loadCloud('modular', { payments: false });
    const { result, messages } = await unconfigured.runJob('reviewPendingDonations');

    assert.equal(result, 'skipped');
    assert.match(messages[0], /غير مهيأة/);
  });
});

test('نقطة نهاية البوابة', async (t) => {
  let api;
  let mosque;
  let transaction;

  t.beforeEach(() => {
    process.env.PAYMENT_WEBHOOK_SECRET = 'whsec_correct_value';
    api = loadCloud('modular');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 0 });
    const serviceRequest = api.make('ServiceRequests',
      { mosqueId: mosque, title: 'إصلاح', estimatedCost: 500, fundedAmount: 0, status: 'pending_funding' });
    transaction = api.make('Transactions', {
      donorId: api.asUser('user_donor'),
      mosqueId: mosque,
      requestId: serviceRequest,
      amount: 500,
      type: 'donation',
      status: 'pending',
      paymentSessionId: 'sess_hook',
    });
  });

  t.afterEach(() => { delete process.env.PAYMENT_WEBHOOK_SECRET; });

  await t.test('السرّ الخاطئ يُرفض', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { error } = await api.call('paymentWebhook',
      { secret: 'whsec_wrong_value___', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
    assert.equal(mosque.get('walletBalance'), 0);
  });

  await t.test('السرّ الناقص يُرفض ولو كان بادئةً صحيحة', async () => {
    const { error } = await api.call('paymentWebhook',
      { secret: 'whsec_correct', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });

  await t.test('السرّ الصحيح يُقيّد الدفع', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);

    const { ok } = await api.call('paymentWebhook',
      { secret: 'whsec_correct_value', clientReferenceId: transaction.id });

    assert.equal(ok.status, 'captured');
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('جسم الطلب لا يُصدَّق — البوابة وحدها تُقرّر', async () => {
    // البوابة تقول "غير مدفوع"، والجسم يدّعي الدفع
    api.gateway.status = 'unpaid';

    const { ok } = await api.call('paymentWebhook', {
      secret: 'whsec_correct_value',
      clientReferenceId: transaction.id,
      payment_status: 'paid',
      total_amount: 500000,
    });

    assert.equal(ok.status, 'pending');
    assert.equal(mosque.get('walletBalance'), 0, 'قُيّد مبلغ بناءً على ادّعاء المُرسِل');
  });

  await t.test('الاستدعاء المكرَّر لا يضاعف الرصيد', async () => {
    api.gateway.status = 'paid';
    api.gateway.amountBaisa = OMR(500);
    const params = { secret: 'whsec_correct_value', clientReferenceId: transaction.id };

    await api.call('paymentWebhook', params);
    const again = await api.call('paymentWebhook', params);

    assert.equal(again.ok.status, 'captured');
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('بلا سرّ مضبوط تُرفض النقطة كلياً', async () => {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    const unconfigured = loadCloud('modular');

    const { error } = await unconfigured.call('paymentWebhook',
      { secret: 'anything', clientReferenceId: transaction.id });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('تقليم سجل التدقيق', async (t) => {
  let api;

  t.beforeEach(() => { api = loadCloud('modular'); });

  const entryAgedDays = (days) => api.make('AuditLog', { action: 'request_created' },
    new Date(Date.now() - days * 24 * 3600 * 1000));

  await t.test('يحذف ما تجاوز مدة الحفظ ويُبقي ما دونها', async () => {
    entryAgedDays(200);
    entryAgedDays(200);
    const kept = entryAgedDays(10);

    const { result } = await api.runJob('pruneAuditLog');

    assert.match(result, /حُذف 2/);
    assert.deepEqual(api.store.AuditLog, [kept]);
  });

  await t.test('مدة الحفظ لا تنزل عن 30 يوماً مهما طُلب', async () => {
    const recent = entryAgedDays(20);

    await api.runJob('pruneAuditLog', { retentionDays: 1 });

    assert.deepEqual(api.store.AuditLog, [recent],
      'مدة أقصر من 30 يوماً تمسح سجلاً ما زال لازماً للمساءلة');
  });

  await t.test('سجل فارغ لا يُخطئ', async () => {
    const { result } = await api.runJob('pruneAuditLog');
    assert.match(result, /حُذف 0/);
  });
});
```

#### `tests/users.test.js` — الحسابات والاسترداد والبحث

```javascript
/**
 * شؤون الحسابات والاسترداد والبحث — البنود الأخيرة من «ما لم يُعالَج».
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCloud } = require('./helpers/parse-mock');

test('اعتماد الشركات', async (t) => {
  let api;
  let admin;

  t.beforeEach(() => {
    api = loadCloud('modular');
    admin = api.asUser('user_admin', 'admin');
  });

  const contractor = (extra = {}) => api.make('_User',
    { role: 'contractor', isVerifiedContractor: false, companyName: 'شركة النور', ...extra });

  await t.test('المشرف يرى المنتظرين بسجلّهم التجاري', async () => {
    contractor({ crNumber: '1234567', fullName: 'مؤسسة النور' });

    const { ok } = await api.call('listPendingContractors', {}, { user: admin });

    assert.equal(ok.length, 1);
    assert.equal(ok[0].companyName, 'شركة النور');
    assert.equal(ok[0].crNumber, '1234567', 'السجل التجاري أساس القرار');
  });

  await t.test('لا اعتماد بلا سجل تجاري', async () => {
    const pending = contractor();
    const { error } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
    assert.equal(pending.get('isVerifiedContractor'), false);
  });

  await t.test('الاعتماد يُغيّر الحقل ويُقيَّد ويُشعِر', async () => {
    const pending = contractor({ crNumber: '1234567' });

    const { ok } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: admin });

    assert.equal(ok.isVerifiedContractor, true);
    assert.equal(pending.get('isVerifiedContractor'), true);
    assert.ok(api.store.AuditLog.some((e) => e.get('action') === 'contractor_reviewed'));
    assert.equal(api.pushes.at(-1).users[0].id, pending.id);
  });

  await t.test('المتطوّع ليس شركة', async () => {
    const volunteer = api.make('_User', { role: 'volunteer' });
    const { error } = await api.call('reviewContractor',
      { contractorId: volunteer.id, approve: true }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
  });

  await t.test('غير المشرف لا يعتمد', async () => {
    const pending = contractor({ crNumber: '7' });
    const { error } = await api.call('reviewContractor',
      { contractorId: pending.id, approve: true }, { user: api.asUser('u', 'imam') });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('الملف الشخصي والمسجد المفضّل', async (t) => {
  let api;
  let user;

  t.beforeEach(() => {
    api = loadCloud('modular');
    user = api.make('_User', { role: 'volunteer', fullName: 'سالم', skills: ['كهرباء'] });
  });

  await t.test('ضبط المسجد المفضّل يتحقق من وجوده', async () => {
    const { error } = await api.call('setFavoriteMosque',
      { mosqueId: 'لا-وجود-له' }, { user });
    assert.equal(error.code, api.ParseError.OBJECT_NOT_FOUND);
  });

  await t.test('الضبط ثم القراءة', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان' });

    const set = await api.call('setFavoriteMosque', { mosqueId: mosque.id }, { user });
    assert.equal(set.ok.mosqueName, 'جامع السلطان');

    const profile = await api.call('getMyProfile', {}, { user });
    assert.equal(profile.ok.favoriteMosqueName, 'جامع السلطان');
    assert.deepEqual(profile.ok.skills, ['كهرباء']);
    assert.equal(profile.ok.role, 'volunteer');
  });

  await t.test('الإرسال بلا معرّف يمسح التفضيل', async () => {
    const mosque = api.make('Mosques', { name: 'جامع السلطان' });
    await api.call('setFavoriteMosque', { mosqueId: mosque.id }, { user });

    const cleared = await api.call('setFavoriteMosque', {}, { user });
    assert.equal(cleared.ok.favoriteMosqueId, null);
    assert.equal((await api.call('getMyProfile', {}, { user })).ok.favoriteMosqueId, null);
  });
});

test('استرداد التبرّع', async (t) => {
  let api;
  let admin;
  let mosque;
  let serviceRequest;
  let donation;

  t.beforeEach(() => {
    api = loadCloud('modular');
    admin = api.asUser('user_admin', 'admin');
    mosque = api.make('Mosques', { name: 'مسجد الاختبار', walletBalance: 500 });
    serviceRequest = api.make('ServiceRequests', {
      mosqueId: mosque, title: 'ترميم', estimatedCost: 500, fundedAmount: 500,
      status: 'funded', isFundedByDonors: true,
    });
    donation = api.make('Transactions', {
      donorId: api.asUser('user_donor'), mosqueId: mosque, requestId: serviceRequest,
      amount: 500, type: 'donation', status: 'captured',
    });
  });

  await t.test('الاسترداد يعيد الرصيد ويُرجع الطلب للتمويل', async () => {
    const { ok } = await api.call('refundDonation',
      { transactionId: donation.id, reason: 'أُلغي الطلب' }, { user: admin });

    assert.equal(ok.fundedAmount, 0);
    assert.equal(mosque.get('walletBalance'), 0);
    assert.equal(donation.get('status'), 'refunded');
    assert.equal(serviceRequest.get('status'), 'pending_funding');
    assert.equal(serviceRequest.get('isFundedByDonors'), false);

    const entry = api.store.Transactions.find((tx) => tx.get('type') === 'refund');
    assert.ok(entry, 'لم يُقيَّد سطر استرداد');
    assert.equal(entry.get('amount'), 500);
  });

  await t.test('لا استرداد مرتين', async () => {
    await api.call('refundDonation', { transactionId: donation.id }, { user: admin });
    const again = await api.call('refundDonation', { transactionId: donation.id }, { user: admin });

    assert.equal(again.error.code, api.ParseError.DUPLICATE_VALUE);
    assert.equal(mosque.get('walletBalance'), 0, 'خُصم المبلغ مرتين');
  });

  await t.test('لا استرداد بعد صرف المستحقات', async () => {
    serviceRequest.set('isPaidOut', true);
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: admin });

    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
    assert.equal(mosque.get('walletBalance'), 500);
  });

  await t.test('لا استرداد لمبلغ أُنفق على طلب آخر', async () => {
    mosque.set('walletBalance', 100); // صُرف معظمه
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: admin });

    assert.equal(error.code, api.ParseError.VALIDATION_ERROR);
    assert.equal(mosque.get('walletBalance'), 100, 'التعويض لم يُعِد الرصيد');
  });

  await t.test('غير المشرف لا يسترد', async () => {
    const { error } = await api.call('refundDonation',
      { transactionId: donation.id }, { user: api.asUser('u', 'imam') });
    assert.equal(error.code, api.ParseError.OPERATION_FORBIDDEN);
  });
});

test('بحث المساجد', async (t) => {
  let api;
  let user;

  t.beforeEach(() => {
    api = loadCloud('modular');
    user = api.asUser('user_any', 'donor');
    api.make('Mosques', { name: 'مسجد النور', nameNormalized: 'مسجد النور', governorate: 'مسقط' });
    api.make('Mosques', { name: 'جامع النور', nameNormalized: 'جامع النور', governorate: 'ظفار' });
  });

  await t.test('البادئة المثبّتة تُستعمل أولاً', async () => {
    const { ok } = await api.call('searchMosques', { term: 'مسجد' }, { user });
    assert.equal(ok.length, 1);
    assert.equal(ok[0].name, 'مسجد النور');
  });

  await t.test('كلمة من وسط الاسم تسقط إلى المسح', async () => {
    const { ok } = await api.call('searchMosques', { term: 'النور' }, { user });
    assert.equal(ok.length, 2, 'لا نتيجة بالبادئة، فيلزم `contains` كخطة بديلة');
  });

  // البيانات مخزَّنة مطبَّعة؛ لو لم يُطبَّع المصطلح لضاع الحقل كله
  await t.test('التاء المربوطة والألف المهموزة تُطبَّعان قبل البحث', async () => {
    api.make('Mosques', { name: 'مسجد الرحمة', nameNormalized: 'مسجد الرحمه' });

    const exact = await api.call('searchMosques', { term: 'مسجد الرحمة' }, { user });
    assert.equal(exact.ok.length, 1, 'كُتبت بالتاء المربوطة والمخزَّن بالهاء');

    api.make('Mosques', { name: 'مسجد الإيمان', nameNormalized: 'مسجد الايمان' });
    const hamza = await api.call('searchMosques', { term: 'مسجد الإيمان' }, { user });
    assert.equal(hamza.ok.length, 1, 'الهمزة على الألف');
  });

  await t.test('قيد المحافظة يُطبَّق في الحالتين', async () => {
    const prefix = await api.call('searchMosques', { term: 'مسجد', governorate: 'ظفار' }, { user });
    assert.equal(prefix.ok.length, 0);

    const substring = await api.call('searchMosques', { term: 'النور', governorate: 'ظفار' }, { user });
    assert.equal(substring.ok.length, 1);
    assert.equal(substring.ok[0].name, 'جامع النور');
  });
});
```

#### `tests/schema.test.js` — الصلاحيات وتطابق النسختين

```javascript
/**
 * المخطط ونقاط الدخول.
 *
 * `apply_schema.js` لا يستدعي `setCLP` إلا عند وجود المفتاح، فغيابه عن فئة
 * يعني بصمت أنها تبقى على إعداد الخادم الافتراضي — وهي الطريقة التي بقيت بها
 * `_User` مكشوفة. هذا الملف يحرس ذلك ويحرس تطابق النسختين المجزّأة والمدمجة.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadCloud, CLOUD } = require('./helpers/parse-mock');

const schema = JSON.parse(
  fs.readFileSync(path.join(CLOUD, 'schema.json'), 'utf8'));

const classOf = (name) => schema.classes.find((c) => c.className === name);

test('المخطط', async (t) => {
  await t.test('كل فئة تعرّف صلاحياتها صراحةً', () => {
    for (const definition of schema.classes) {
      assert.ok(definition.classLevelPermissions,
        `${definition.className} بلا classLevelPermissions — ستبقى على إعداد الخادم الافتراضي`);
    }
  });

  await t.test('_User: القراءة مصادَقة والحقول الحسّاسة محميّة', () => {
    const clp = classOf('_User').classLevelPermissions;

    assert.equal(clp.find.requiresAuthentication, true);
    assert.equal(clp.get.requiresAuthentication, true);
    assert.deepEqual(clp.create, { '*': true }, 'التسجيل يمرّ عبر create فيبقى مفتوحاً');

    for (const field of ['phone', 'lastKnownLocation']) {
      assert.ok(clp.protectedFields['*'].includes(field),
        `${field} مكشوف — موقع المتطوّع ورقمه ليسا عامّين`);
    }
  });

  await t.test('الفئات المالية مقفلة للكتابة من العميل', () => {
    for (const name of ['Mosques', 'ServiceRequests', 'Transactions']) {
      const clp = classOf(name).classLevelPermissions;
      for (const action of ['create', 'update', 'delete']) {
        assert.deepEqual(clp[action], {},
          `${name}.${action} مفتوح — الكتابة يجب أن تمرّ بدوال السحابة`);
      }
    }
  });

  await t.test('TaskInterests مقفلة — القائمة تمرّ بدالة تتحقق من ملكية المسجد', () => {
    const clp = classOf('TaskInterests').classLevelPermissions;
    for (const action of ['find', 'get', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[action], {}, `TaskInterests.${action} مفتوح`);
    }
  });

  await t.test('AuditLog مقفل تماماً — يُقرأ عبر دالة السحابة وحدها', () => {
    const clp = classOf('AuditLog').classLevelPermissions;
    for (const action of ['find', 'get', 'create', 'update', 'delete']) {
      assert.deepEqual(clp[action], {}, `AuditLog.${action} مفتوح — يكشف هوية الفاعل`);
    }
  });

  await t.test('walletBalance غير مقروء من العميل', () => {
    assert.ok(classOf('Mosques').classLevelPermissions.protectedFields['*']
      .includes('walletBalance'));
  });
});

test('نقاط الدخول', async (t) => {
  const EXPECTED_FUNCTIONS = [
    'getNearbyMosques', 'searchMosques', 'claimMosque', 'getMyClaims', 'reviewMosqueClaim',
    'createServiceRequest', 'expressInterest', 'withdrawInterest',
    'getRequestInterests', 'getMyInterests', 'assignWorker', 'startWork', 'markWorkDone',
    'completeService', 'cancelServiceRequest', 'initiateDonation',
    'confirmDonation', 'paymentWebhook', 'payoutContractor', 'refundDonation',
    'getMosqueLedger', 'listPendingContractors', 'reviewContractor',
    'setFavoriteMosque', 'getMyProfile',
    'getMosqueAuditTrail', 'health',
  ];

  const EXPECTED_TRIGGERS = [
    'beforeSave:_User', 'afterSave:_User', 'beforeSave:Mosques',
    'beforeSave:ServiceRequests', 'beforeSave:Transactions',
    'afterSave:ServiceRequests',
  ];

  await t.test('النسختان تسجّلان الدوال والمُشغّلات نفسها', () => {
    for (const entry of ['modular', 'bundle']) {
      const api = loadCloud(entry);
      assert.deepEqual(Object.keys(api.functions).sort(), [...EXPECTED_FUNCTIONS].sort(),
        `دوال النسخة ${entry} لا تطابق المتوقَّع`);
      assert.deepEqual(Object.keys(api.triggers).sort(), [...EXPECTED_TRIGGERS].sort(),
        `مُشغّلات النسخة ${entry} لا تطابق المتوقَّع`);
    }
  });

  await t.test('المهمة الدورية مسجَّلة في النسختين', () => {
    for (const entry of ['modular', 'bundle']) {
      const api = loadCloud(entry);
      assert.deepEqual(Object.keys(api.jobs).sort(),
        ['pruneAuditLog', 'reviewPendingDonations'], `النسخة ${entry}`);
    }
  });

  await t.test('النسخة المدمجة بلا استيراد نسبي ولا تصدير', () => {
    const bundle = fs.readFileSync(path.join(CLOUD, 'main.bundle.js'), 'utf8');

    // الاستيراد النسبي بلا معنى في ملف واحد، والتصدير كذلك
    assert.equal(/require\(['"]\./.test(bundle), false);
    assert.equal(/\bmodule\.exports\b/.test(bundle), false);

    // أما وحدات Node فتبقى: حذفها كان يترك مرجعاً غير معرّف
    assert.equal(/require\(['"]crypto['"]\)/.test(bundle), true);
  });

  await t.test('health يعكس تهيئة بوابة الدفع', async () => {
    const api = loadCloud('modular');
    const { ok } = await api.call('health');
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.paymentsConfigured, 'boolean');
  });
});
```

#### `tests/integration/harness.js` — تشغيل parse-server حقيقي فوق PostgreSQL

```javascript
/**
 * تشغيل `parse-server` حقيقي فوق PostgreSQL مؤقّت، بكود السحابة كما هو.
 *
 * لماذا يلزم رغم وجود البديل في الذاكرة: البديل يرصد أخطاء المنطق لا أخطاء
 * المنصّة. أول تشغيل حقيقي كشف خللين كانا يمنعان الإطلاق والاختبارات خضراء —
 * قيمة المخطط الافتراضية التي تُعلّم الحقل مُعدَّلاً فتمنع كل تسجيل، وفشلُ
 * استعلام جغرافي يُسقط إنشاء الطلب. راجع «جولة رابعة» في `docs/REVIEW.md`.
 *
 * يتخطّى نفسه بلا فشل إن غابت أدوات PostgreSQL أو حزم التطوير، فلا يكسر
 * `npm test` على جهاز لا يملكها.
 */

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const CLOUD_MAIN = path.join(__dirname, '..', '..', 'cloud', 'main.js');

const APP_ID = 'masjidi-integration';
const MASTER_KEY = 'integration-master-key';
const JS_KEY = 'integration-js-key';

/** يعثر على أدوات PostgreSQL: من PATH أو من مسار التوزيعة المعتاد. */
function findPostgresBin() {
  try {
    const dir = path.dirname(execFileSync('which', ['pg_ctl'], { encoding: 'utf8' }).trim());
    if (dir) return dir;
  } catch {
    // ليست في PATH — نبحث في مسارات التوزيعة
  }

  for (const base of ['/usr/lib/postgresql', '/usr/local/pgsql', '/opt/homebrew/opt']) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base).sort().reverse()) {
      const candidate = path.join(base, entry, 'bin');
      if (fs.existsSync(path.join(candidate, 'pg_ctl'))) return candidate;
    }
  }
  return null;
}

/** سبب التخطّي، أو `null` إن كانت البيئة صالحة. */
function unavailableReason() {
  if (!findPostgresBin()) return 'أدوات PostgreSQL غير متوفّرة';
  try {
    require.resolve('parse-server');
    require.resolve('parse/node');
  } catch {
    return 'حزم التطوير غير مثبّتة — شغّل `npm install`';
  }
  return null;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * `initdb` يرفض العمل بصلاحيات الجذر. في الحاويات التي تعمل كجذر نُسند العملية
 * إلى مستخدم `postgres` إن وُجد — وهو ما يفرض وضع الدليل في مكانٍ يصله.
 */
function rootFallbackUser() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'ignore' });
    return 'postgres';
  } catch {
    return null;
  }
}

function makeRunner(binDir, asUser, dataRoot) {
  return (tool, args) => {
    const command = `${path.join(binDir, tool)} ${args.map((a) => `'${a}'`).join(' ')}`;
    if (asUser) {
      return execFileSync('su', [asUser, '-c', command], { encoding: 'utf8', stdio: 'pipe' });
    }
    return execFileSync(path.join(binDir, tool), args, { encoding: 'utf8', stdio: 'pipe' });
  };
}

/**
 * يُشغّل قاعدة بيانات وخادماً، ويعيد `{ serverURL, stop }`.
 * الاستدعاء يفترض أن `unavailableReason()` أعادت `null`.
 */
async function startStack() {
  const binDir = findPostgresBin();
  const asUser = rootFallbackUser();

  // مستخدم postgres لا يصل إلى دليل مؤقّت مملوك للجذر، فنضع العنقود في بيته
  const root = asUser
    ? fs.mkdtempSync('/var/lib/postgresql/masjidi-it-')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'masjidi-it-'));
  if (asUser) execFileSync('chown', ['-R', `${asUser}:${asUser}`, root]);

  const dataDir = path.join(root, 'data');
  const run = makeRunner(binDir, asUser, root);
  const pgPort = await freePort();

  run('initdb', ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  run('pg_ctl', ['-D', dataDir, '-o', `-p ${pgPort} -c listen_addresses=127.0.0.1`,
    '-l', path.join(root, 'pg.log'), '-w', 'start']);
  run('createdb', ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', 'masjidi']);

  const { ParseServer } = require('parse-server');
  const express = require('express');
  const apiPort = await freePort();
  const serverURL = `http://127.0.0.1:${apiPort}/parse`;

  const parseServer = new ParseServer({
    databaseURI: `postgres://postgres@127.0.0.1:${pgPort}/masjidi`,
    cloud: CLOUD_MAIN,
    appId: APP_ID,
    masterKey: MASTER_KEY,
    javascriptKey: JS_KEY,
    serverURL,
    allowClientClassCreation: false,
    directAccess: true,
    silent: true,
  });

  await parseServer.start();
  const app = express();
  app.use('/parse', parseServer.app);
  const http = await new Promise((resolve) => {
    const listener = app.listen(apiPort, '127.0.0.1', () => resolve(listener));
  });

  const Parse = require('parse/node');
  Parse.initialize(APP_ID, JS_KEY, MASTER_KEY);
  Parse.serverURL = serverURL;

  async function stop() {
    await new Promise((resolve) => http.close(resolve));
    try { await parseServer.handleShutdown(); } catch { /* الخادم مُغلق أصلاً */ }
    try { run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']); } catch { /* توقّف */ }
    fs.rmSync(root, { recursive: true, force: true });
  }

  return { Parse, serverURL, appId: APP_ID, masterKey: MASTER_KEY, stop };
}

/** تطبيق `cloud/schema.json` كما يفعل `scripts/apply_schema.js`. */
async function applySchema(Parse) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'cloud', 'schema.json'), 'utf8'));

  for (const definition of schema.classes) {
    const parseSchema = new Parse.Schema(definition.className);
    let existing = null;
    try { existing = await parseSchema.get(); } catch { /* فئة جديدة */ }

    const existingFields = existing ? existing.fields : {};
    for (const [name, spec] of Object.entries(definition.fields || {})) {
      if (existingFields[name]) continue;
      const options = {};
      if (spec.required) options.required = true;
      if (spec.defaultValue !== undefined) options.defaultValue = spec.defaultValue;

      if (spec.type === 'Pointer') parseSchema.addPointer(name, spec.targetClass, options);
      else parseSchema[`add${spec.type}`](name, options);
    }

    if (definition.classLevelPermissions) parseSchema.setCLP(definition.classLevelPermissions);
    existing ? await parseSchema.update() : await parseSchema.save();
  }
}

module.exports = { startStack, applySchema, unavailableReason, APP_ID, MASTER_KEY, JS_KEY };
```

#### `tests/integration/flow.test.js` — الرحلة الكاملة على خادم حقيقي

```javascript
/**
 * اختبار تكامل: الرحلة كاملة على خادم Parse حقيقي.
 *
 * ما يُغطّيه هنا ولا يُغطّيه البديل في الذاكرة: تطبيق المخطط وقيمه الافتراضية،
 * والصلاحيات كما يطبّقها الخادم فعلاً، وACL المستخدم، وأخطاء قاعدة البيانات.
 *
 * لا يُشغَّل مع `npm test` — استعمل `npm run test:integration`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { startStack, applySchema, unavailableReason } = require('./harness');

// `{ skip: null }` يعامله المُشغّل تخطّياً، فلا يُمرَّر المفتاح إلا عند وجود سبب
const skip = unavailableReason();
const options = skip ? { skip } : {};

test('الرحلة الكاملة على خادم حقيقي', options, async (t) => {
  const stack = await startStack();
  const { Parse } = stack;
  t.after(() => stack.stop());

  const MASTER = { useMasterKey: true };
  const as = (user, fn, params = {}) =>
    Parse.Cloud.run(fn, params, { sessionToken: user.getSessionToken() });

  let unique = 0;
  async function signUp(role, extra = {}) {
    const user = new Parse.User();
    user.set('username', `${role}_${Date.now()}_${++unique}`);
    user.set('password', 'Integration12345!');
    user.set('role', role);
    for (const [key, value] of Object.entries(extra)) user.set(key, value);
    await user.signUp();
    return user;
  }

  await t.test('المخطط يُطبَّق كاملاً', async () => {
    await applySchema(Parse);
    const schema = await new Parse.Schema('AuditLog').get();
    assert.ok(schema.fields.action, 'AuditLog لم تُنشأ');
  });

  // ⚠️ هذا ما فشل على أول خادم حقيقي: `isVerifiedContractor` له قيمة افتراضية
  // في المخطط، فيطبّقها Parse عند الإنشاء ويُعلّم الحقل مُعدَّلاً، فكان الحارس
  // يرفض كل تسجيل. لا يظهر إلا هنا لأن البديل لا يطبّق القيم الافتراضية.
  await t.test('التسجيل يعمل رغم القيم الافتراضية في المخطط', async () => {
    const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
    assert.ok(imam.id);
    assert.equal(imam.get('role'), 'imam');
    assert.equal(imam.get('isVerifiedContractor'), false, 'الحساب الجديد يبدأ غير معتمد');
  });

  await t.test('الحمايات التي يطبّقها الخادم', async () => {
    const imam = await signUp('imam');

    const rogue = new Parse.Object('ServiceRequests');
    rogue.set('title', 'طلب مزوّر');
    rogue.set('status', 'completed');
    await assert.rejects(
      () => rogue.save(null, { sessionToken: imam.getSessionToken() }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN,
      'CLP لا يمنع الكتابة المباشرة على ServiceRequests');

    const contractor = await signUp('contractor', { companyName: 'شركة الاختبار' });
    contractor.set('isVerifiedContractor', true);
    await assert.rejects(() => contractor.save(null, { sessionToken: contractor.getSessionToken() }),
      'شركة اعتمدت نفسها');
  });

  await t.test('حساب المستخدم مقفل على صاحبه', async () => {
    const volunteer = await signUp('volunteer', { phone: '9900xxxx' });
    const stranger = await signUp('donor');

    const seen = await new Parse.Query(Parse.User).equalTo('objectId', volunteer.id)
      .find({ sessionToken: stranger.getSessionToken() });

    if (seen.length > 0) {
      assert.equal(seen[0].get('phone'), undefined, 'رقم الهاتف مكشوف لمستخدم آخر');
      assert.equal(seen[0].get('lastKnownLocation'), undefined, 'موقع المتطوّع مكشوف');
    }
  });

  await t.test('الرحلة: من طلب الملكية إلى اعتماد العمل', async () => {
    const imam = await signUp('imam', { fullName: 'الشيخ سعيد' });
    const volunteer = await signUp('volunteer', { fullName: 'سالم', skills: ['كهرباء'] });
    const rival = await signUp('volunteer', { fullName: 'خالد' });
    const admin = await signUp('donor');
    admin.set('role', 'admin');
    await admin.save(null, MASTER);

    const Mosque = Parse.Object.extend('Mosques');
    const mosque = new Mosque();
    mosque.set('externalId', `it-${Date.now()}`);
    mosque.set('name', 'مسجد الاختبار');
    mosque.set('nameNormalized', 'مسجد الاختبار');
    mosque.set('governorate', 'مسقط');
    mosque.set('wilayat', 'العامرات');
    await mosque.save(null, MASTER);

    const claim = await as(imam, 'claimMosque', { mosqueId: mosque.id, evidenceNote: 'إفادة' });
    const mine = await as(imam, 'getMyClaims');
    assert.equal(mine[0].status, 'pending');
    assert.equal(mine[0].mosqueName, 'مسجد الاختبار');

    await as(admin, 'reviewMosqueClaim', { claimId: claim.claimId, approve: true });
    assert.equal((await as(imam, 'getMyClaims'))[0].status, 'approved');

    await assert.rejects(
      () => as(imam, 'createServiceRequest',
        { title: 'إصلاح', description: 'وصف كافٍ للطلب', estimatedCost: 'كثير' }),
      (error) => error.code === Parse.Error.VALIDATION_ERROR);

    // ⚠️ هذا ما فشل أيضاً على أول خادم حقيقي: الإشعار للمتطوّعين القريبين رفع
    // خطأً فأسقط الدالة كلها بعد أن كان الطلب قد حُفظ.
    const request = await as(imam, 'createServiceRequest', {
      title: 'تصليح إنارة الصحن',
      description: 'ثلاث لمبات محترقة تحتاج استبدالاً.',
      category: 'electrical',
    });
    assert.equal(request.status, 'open_for_volunteers');

    await as(volunteer, 'expressInterest', { requestId: request.objectId, note: 'بعد الجمعة' });
    await as(rival, 'expressInterest', { requestId: request.objectId });
    await assert.rejects(() => as(volunteer, 'expressInterest', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.DUPLICATE_VALUE);

    const interests = await as(imam, 'getRequestInterests', { requestId: request.objectId });
    assert.equal(interests.length, 2);
    assert.equal(interests[0].phone, undefined, 'هاتف المتطوّع لا يُعاد للإمام');

    const stranger = await signUp('imam');
    await assert.rejects(() => as(stranger, 'getRequestInterests', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(imam, 'assignWorker', { requestId: request.objectId, workerId: volunteer.id });
    assert.equal((await as(imam, 'getRequestInterests', { requestId: request.objectId })).length, 0,
      'الاهتمامات لم تُقفل بعد التكليف');

    await assert.rejects(() => as(rival, 'startWork', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(volunteer, 'startWork', { requestId: request.objectId });
    await assert.rejects(() => as(imam, 'cancelServiceRequest', { requestId: request.objectId }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(volunteer, 'markWorkDone', { requestId: request.objectId, notes: 'استُبدلت اللمبات.' });
    await assert.rejects(
      () => as(volunteer, 'completeService', { requestId: request.objectId, rating: 5 }),
      (error) => error.code === Parse.Error.OPERATION_FORBIDDEN);

    await as(imam, 'completeService', { requestId: request.objectId, rating: 5, volunteerHours: 2 });

    await volunteer.fetch(MASTER);
    assert.equal(volunteer.get('completedJobs'), 1);
    assert.equal(volunteer.get('avgRating'), 5);

    const trail = await as(admin, 'getMosqueAuditTrail', { mosqueId: mosque.id });
    const actions = trail.map((entry) => entry.action);
    for (const expected of ['claim_reviewed', 'request_created', 'interest_expressed',
      'worker_assigned', 'work_started', 'work_done', 'request_completed']) {
      assert.ok(actions.includes(expected), `سجل التدقيق ينقصه ${expected}`);
    }
    assert.ok(trail.every((entry) => entry.actorId === undefined), 'هوية الفاعل مُعادة');
  });
});
```

---

## 10. خطة التشغيل

```bash
npm install
cp .env.example .env      # املأ مفاتيح Back4app
npm test                  # اختبارات دوال السحابة — بلا خادم ولا مفاتيح
```

### 1. تجهيز البيانات

```bash
# البيانات جاهزة في data/mosques.json — أعد التوليد فقط عند تحديث الملف الحكومي
python3 scripts/clean_mosques.py "Masajid Data with geographic locations.xlsx"
```

### 2. تطبيق المخطط

```bash
node scripts/apply_schema.js
```

ثم أضف يدوياً من لوحة Back4app (Database → Indexes):
- فهرس `2dsphere` على `Mosques.location` ← **إلزامي**
- فهرس `2dsphere` على `_User.lastKnownLocation`

### 3. الاستيراد

```bash
node scripts/seed_mosques.js --limit 100   # تجربة
node scripts/seed_mosques.js               # الكامل (~18k سجل)
```

### 4. نشر Cloud Code

ارفع محتوى مجلد `cloud/` عبر لوحة Back4app أو الـ CLI، ثم تحقق:

```bash
curl -X POST https://parseapi.back4app.com/functions/health \
  -H "X-Parse-Application-Id: $PARSE_APP_ID" \
  -H "X-Parse-REST-API-Key: $PARSE_REST_KEY"
```

### مراحل الإطلاق

**المرحلة 1 — تطوّع عيني فقط (بلا مال):** استيراد البيانات، تسجيل الأئمة،
طلبات بتكلفة صفر، إشعارات للمتطوعين القريبين، وتسجيل الاهتمام واختيار الإمام. لا تحتاج تصريح جمع تبرعات ولا
بوابة دفع. هذه هي النسخة القابلة للإطلاق فعلياً.

**المرحلة 2 — الشركات المعتمدة:** إضافة الشركات، عروض الأسعار، التقييمات.

**المرحلة 3 — التبرعات:** بعد الحصول على تصريح وزارة الأوقاف والسجل التجاري
وحساب تاجر لدى ثواني. الكود جاهز ومعطّل.
