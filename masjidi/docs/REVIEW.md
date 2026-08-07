# مراجعة الكود الأصلي — ما أُصلح ولماذا

المواصفات الأصلية في `PROJECT_SPEC.md` سليمة معمارياً، لكن كود `main.js` فيها
كان يحتوي أخطاء تمنع تشغيله في الإنتاج. هذه قائمة بها مرتّبة بالخطورة.

---

## 🔴 حرج — ثغرات مالية

### 1. التبرع بدون دفع
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

### 2. الرصيد يصبح NaN
```js
const mosque = serviceReq.get("mosqueId");        // Pointer غير مُحمّل
const currentBalance = mosque.get("walletBalance") || 0;   // undefined → 0
mosque.set("walletBalance", 0 + amount);          // ← مسح الرصيد السابق!
```
الـ Pointer المُعاد من `get()` لا يحمل بياناته. النتيجة أن كل تبرع كان
**يستبدل** الرصيد بدل أن يضيف إليه.

**الإصلاح:** `fetchPointer()` قبل القراءة، و`increment()` الذرّية بدل
قراءة‑ثم‑كتابة (التي تفقد تبرعات متزامنة أصلاً).

### 3. تمويل جزئي يُعتبر كاملاً
طلب تكلفته 500 ريال يصبح `funded` بتبرع قدره ريال واحد.

**الإصلاح:** حقل `fundedAmount` تراكمي؛ الحالة تتغيّر عند بلوغ `estimatedCost`،
ويُرفض أي مبلغ يتجاوز المتبقي.

---

## 🟠 عالٍ — إشعارات لا تصل أبداً

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

## 🟠 عالٍ — ثغرة صلاحيات

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

## 🟡 متوسط

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

## ما لم يُعالَج بعد

- **لا توجد اختبارات.** المنطق المالي بلا تغطية = خطر. أولوية أولى.
- **لا يوجد webhook للبوابة** — `confirmDonation` تُستدعى من العميل عند العودة،
  وإذا أغلق المستخدم التطبيق تبقى المعاملة `pending`. يلزم مهمة دورية
  (`Parse.Cloud.job`) تُراجع المعاملات المعلّقة.
- **لا يوجد استرداد (refund)** لحالات إلغاء الطلب بعد التمويل.
- **لا يوجد سجل تدقيق** لتغييرات الحالة — مفيد للشفافية أمام المتبرعين.
