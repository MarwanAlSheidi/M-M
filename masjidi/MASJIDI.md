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
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) |
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
| تطبيق العميل | ❌ لم يبدأ |
| الاختبارات | ❌ لا توجد |

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
8. **لا تعديل على `data/mosques.json` يدوياً** — عدّل السكربت وأعد توليده.
9. الكود بالإنجليزية، التعليقات ورسائل المستخدم بالعربية الفصحى.

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
  functions/
    mosques.js         البحث، القرب الجغرافي، طلب ملكية المسجد
    requests.js        دورة حياة طلب الصيانة
    donations.js       التبرع، التأكيد، الصرف، السجل المالي
scripts/
  clean_mosques.py     Excel → JSON نظيف
  seed_mosques.js      استيراد إلى Parse (idempotent)
  apply_schema.js      تطبيق schema.json
  build_single_file.py توليد cloud/main.bundle.js من ملفات cloud/
  build_single_doc.py  توليد MASJIDI.md من المستودع كله
data/
  mosques.json         18,214 سجلاً جاهزاً
  cleaning_report.json تقرير جودة البيانات
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

### ما لم يُعالَج بعد

- **لا توجد اختبارات في المستودع.** المنطق المالي بلا تغطية = خطر. أولوية أولى.
- **لا يوجد webhook للبوابة.** `confirmDonation` صارت تقبل الاستدعاء بـ Master
  Key فأصبح ربط webhook ممكناً، لكن لا نقطة نهاية مُنفَّذة بعد. وإذا أغلق
  المستخدم التطبيق تبقى المعاملة `pending` حتى تنتهي مهلة الحجز. يلزم
  `Parse.Cloud.job` دورية تُراجع المعاملات المعلّقة وتُقفلها لدى البوابة.
- **لا يوجد استرداد (refund)** لحالات إلغاء الطلب بعد التمويل، ولا للتمويل
  الزائد إن أفلت من الحجز.
- **`payoutContractor` يقرأ الرصيد ثم يُنقصه** — استدعاءان متزامنان يجتازان
  الفحص معاً. `increment` ذرّي لكن الفحص الذي يسبقه ليس كذلك.
- **`cancelServiceRequest` يُلغي طلباً قيد التنفيذ** رغم أن تعليقه يقول
  "قبل التنفيذ"، ولا يُشعر المنفّذ المكلَّف.
- **الدور يُعيّنه المستخدم بنفسه** عدا `admin` — فلا يصلح وحده أساساً للتفويض،
  وكل دالة جديدة يجب أن تتحقق من الملكية لا من الدور فقط.
- **لا يستطيع الإمام رؤية حالة طلب ملكيته** — `MosqueClaims` مقفلة على Master
  Key ولا دالة تُعيدها.
- **حقول معرّفة ولا تُكتب أبداً:** `completedJobs` و`avgRating` و`skills` و
  `favoriteMosqueId` و`crNumber` و`companyName` — تقييم المنفّذين معطّل فعلياً.
- **لا يوجد سجل تدقيق** لتغييرات الحالة — مفيد للشفافية أمام المتبرعين.

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
    if (user.dirty('role') && role === 'admin') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
    }
    if (user.dirty('isVerifiedContractor')) {
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

  await Parse.Push.send(
    {
      where: installations,
      data: { sound: 'default', ...payload },
    },
    { useMasterKey: true }
  );
  return { sent: list.length };
}

/** متطوعون قريبون: نطاق جغرافي أولاً، ثم المحافظة كخطة بديلة. */
async function pushToNearbyVolunteers(mosque, payload, radiusKm = 15) {
  const base = new Parse.Query(Parse.User);
  base.equalTo('role', 'volunteer');
  base.equalTo('isActive', true);

  const location = mosque.get('location');
  let volunteers = [];

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

#### `cloud/functions/mosques.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole } = require('../lib/auth');

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

/** بحث نصّي بالاسم أو القرية داخل ولاية/محافظة. */
Parse.Cloud.define('searchMosques', async (request) => {
  requireUser(request);
  const { term, governorate, wilayat, limit = 30 } = request.params;

  const query = new Parse.Query('Mosques');
  if (term && String(term).trim().length >= 2) {
    query.contains('nameNormalized', String(term).trim());
  }
  if (governorate) query.equalTo('governorate', governorate);
  if (wilayat) query.equalTo('wilayat', wilayat);

  query.select(...PUBLIC_FIELDS);
  query.limit(Math.min(Number(limit) || 30, 100));

  const results = await query.find({ useMasterKey: true });
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

  return { status: claim.get('status') };
});
```

#### `cloud/functions/requests.js`

```javascript
const E = require('../lib/errors');
const { requireUser, requireRole, mosqueForImam, fetchPointer } = require('../lib/auth');
const { pushToUsers, pushToNearbyVolunteers } = require('../lib/push');

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

  const cost = Number(estimatedCost) || 0;
  if (cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
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

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
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

  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });
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

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(serviceRequest.get('status'))) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });
  return { status: STATUS.CANCELLED };
});

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
  if (value > (mosque.get('walletBalance') || 0)) E.invalid('رصيد المسجد لا يكفي.');

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

  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
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

  await Parse.Push.send(
    {
      where: installations,
      data: { sound: 'default', ...payload },
    },
    { useMasterKey: true }
  );
  return { sent: list.length };
}

/** متطوعون قريبون: نطاق جغرافي أولاً، ثم المحافظة كخطة بديلة. */
async function pushToNearbyVolunteers(mosque, payload, radiusKm = 15) {
  const base = new Parse.Query(Parse.User);
  base.equalTo('role', 'volunteer');
  base.equalTo('isActive', true);

  const location = mosque.get('location');
  let volunteers = [];

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
    if (user.dirty('role') && role === 'admin') {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'غير مسموح.');
    }
    if (user.dirty('isVerifiedContractor')) {
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

/** بحث نصّي بالاسم أو القرية داخل ولاية/محافظة. */
Parse.Cloud.define('searchMosques', async (request) => {
  requireUser(request);
  const { term, governorate, wilayat, limit = 30 } = request.params;

  const query = new Parse.Query('Mosques');
  if (term && String(term).trim().length >= 2) {
    query.contains('nameNormalized', String(term).trim());
  }
  if (governorate) query.equalTo('governorate', governorate);
  if (wilayat) query.equalTo('wilayat', wilayat);

  query.select(...PUBLIC_FIELDS);
  query.limit(Math.min(Number(limit) || 30, 100));

  const results = await query.find({ useMasterKey: true });
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

  const cost = Number(estimatedCost) || 0;
  if (cost < 0 || cost > MAX_ESTIMATE_OMR) {
    E.invalid(`التكلفة التقديرية يجب أن تكون بين 0 و ${MAX_ESTIMATE_OMR} ريال.`);
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

  if (cost === 0) {
    await pushToNearbyVolunteers(mosque, {
      alert: `فرصة تطوّع: ${serviceRequest.get('title')} — مسجد ${mosque.get('name')}`,
      requestId: serviceRequest.id,
    });
  }

  return serviceRequest.toJSON();
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

  serviceRequest.set('status', STATUS.ASSIGNED);
  serviceRequest.set('assignedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });

  await pushToUsers(worker, {
    alert: `تم تكليفك بـ "${serviceRequest.get('title')}" في مسجد ${mosque.get('name')}.`,
    requestId: serviceRequest.id,
  });

  return serviceRequest.toJSON();
});

/** المنفّذ يبدأ العمل. */
Parse.Cloud.define('startWork', async (request) => {
  const user = requireRole(request, 'volunteer', 'contractor');
  const serviceRequest = await loadAssignedRequest(request.params.requestId, user);

  if (serviceRequest.get('status') !== STATUS.ASSIGNED) E.invalid('الطلب ليس في حالة تكليف.');
  serviceRequest.set('status', STATUS.IN_PROGRESS);
  serviceRequest.set('startedAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });
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

  await mosqueForImam(imam, serviceRequest.get('mosqueId').id);

  if ([STATUS.COMPLETED, STATUS.CANCELLED].includes(serviceRequest.get('status'))) {
    E.invalid('الطلب مغلق بالفعل.');
  }
  if ((serviceRequest.get('fundedAmount') || 0) > 0) {
    E.forbidden('لا يمكن إلغاء طلب استلم تبرعات — تواصل مع الإدارة لإعادة توجيه المبلغ.');
  }

  serviceRequest.set('status', STATUS.CANCELLED);
  serviceRequest.set('cancelledAt', new Date());
  await serviceRequest.save(null, { useMasterKey: true });
  return { status: STATUS.CANCELLED };
});

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
  if (value > (mosque.get('walletBalance') || 0)) E.invalid('رصيد المسجد لا يكفي.');

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

  mosque.increment('walletBalance', -value);
  await mosque.save(null, { useMasterKey: true });

  serviceRequest.set('isPaidOut', true);
  await serviceRequest.save(null, { useMasterKey: true });

  return { message: 'تم تسجيل الصرف.', transactionId: payout.id };
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
| `volunteer` | تصفّح الفرص القريبة، تنفيذ العمل العيني، رفع صور الإنجاز |
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
```

الإلغاء متاح قبل التنفيذ وبشرط `fundedAmount = 0`.

نقطة تصميم مهمة: **المنفّذ يبلّغ بالإنجاز، والإمام هو من يُقفل الطلب.**
هذا يمنع إقفال طلبات لم تُنفَّذ فعلاً.

### دوال السحابة

| الدالة | المستدعي | الوصف |
|---|---|---|
| `getNearbyMosques` | الجميع | مساجد ضمن نطاق (سقف 50 كم، 100 نتيجة) |
| `searchMosques` | الجميع | بحث نصّي مع تطبيع عربي |
| `claimMosque` | imam | طلب ملكية مسجد |
| `reviewMosqueClaim` | admin | اعتماد/رفض الطلب |
| `createServiceRequest` | imam | إنشاء طلب صيانة |
| `assignWorker` | imam | تعيين متطوع أو شركة |
| `startWork` | المنفّذ | بدء التنفيذ |
| `markWorkDone` | المنفّذ | إبلاغ بالإنجاز + صور |
| `completeService` | imam | معاينة واعتماد وتقييم |
| `cancelServiceRequest` | imam | إلغاء قبل التنفيذ |
| `initiateDonation` | متبرع | إنشاء جلسة دفع |
| `confirmDonation` | نظام | تأكيد من البوابة وقيد المبلغ |
| `payoutContractor` | admin | تسجيل صرف المستحقات |
| `getMosqueLedger` | الجميع | السجل المالي الشفاف |
| `health` | الجميع | فحص حالة الخادم |

### قواعد الأمن

| الفئة | القراءة | الكتابة |
|---|---|---|
| `_User` | صاحب الحساب فقط — `afterSave` يقفل الـ ACL عليه عند التسجيل، وقراءة بيانات مستخدم آخر تمرّ عبر دوال السحابة | المستخدم نفسه، مع حظر تعديل `role=admin` و`isVerifiedContractor` |
| `Mosques` | مصادَق | Master Key فقط |
| `ServiceRequests` | مصادَق | Master Key فقط (عبر دوال السحابة) |
| `Transactions` | مصادَق، مع إخفاء بيانات المتبرع | Master Key فقط |
| `MosqueClaims` | Master Key فقط | Master Key فقط |

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
    ("triggers.js", "المُشغّلات (beforeSave / afterSave)"),
    ("functions/mosques.js", "دوال المساجد"),
    ("functions/requests.js", "دوال طلبات الصيانة"),
    ("functions/donations.js", "دوال التبرعات والصرف"),
]

REPLACEMENTS = {
    "lib/errors.js": [(r"module\.exports = \{", "const E = {")],
    "lib/payments.js": [(r"module\.exports = \{[^}]*\};", "const payments = { isConfigured, createCheckoutSession, verifySession };")],
}

DROP = re.compile(r"^\s*(const .*= require\(|module\.exports\s*=\s*\{\s*(ROLES|pushToUsers|STATUS)).*$")


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
    "cloud/functions/mosques.js",
    "cloud/functions/requests.js",
    "cloud/functions/donations.js",
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
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) |
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
                "### `package.json`\n\n" + fence(read("package.json"), "json"))

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
    "lint": "eslint cloud scripts --ext .js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "parse": "^5.3.0"
  },
  "devDependencies": {
    "eslint": "^8.57.0"
  },
  "engines": { "node": ">=18" }
}
```

---

## 10. خطة التشغيل

```bash
npm install
cp .env.example .env      # املأ مفاتيح Back4app
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
طلبات بتكلفة صفر، إشعارات للمتطوعين القريبين. لا تحتاج تصريح جمع تبرعات ولا
بوابة دفع. هذه هي النسخة القابلة للإطلاق فعلياً.

**المرحلة 2 — الشركات المعتمدة:** إضافة الشركات، عروض الأسعار، التقييمات.

**المرحلة 3 — التبرعات:** بعد الحصول على تصريح وزارة الأوقاف والسجل التجاري
وحساب تاجر لدى ثواني. الكود جاهز ومعطّل.
