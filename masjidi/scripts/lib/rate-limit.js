/**
 * حدُّ معدّل الطلبات — **تهيئةُ خادمٍ لا كودُ سحابة**، وهذا درسٌ مقيس.
 *
 * **لماذا يلزم:** لم يكن في المستودع حدُّ معدّلٍ واحد. والباقة المجانية
 * **٢٥ ألف طلبٍ شهرياً**، فحسابٌ واحد يُنادي `searchMosques` في حلقةٍ يُحرقها
 * في دقائق — **وتسقط المنصّة بلا سرقةِ بايتٍ واحد**. ولا يحتاج ذلك خصماً:
 * يكفيه عميلٌ معطوبٌ في حلقةِ إعادةِ محاولة.
 *
 * **ولماذا ليس في `cloud/`:** الصيغة المغرية أن يُمرَّر الحدُّ ثالثاً إلى
 * `Parse.Cloud.define(name, handler, { rateLimit })` — فتُشحن الحماية مع الكود
 * ولا تحتاج لوحةً ولا مالكاً. **وقِيست فإذا هي لا تفعل شيئاً على الإطلاق**،
 * على `parse-server` 9.10.0، بلا خطأٍ ولا تحذير:
 *
 *     الحدود المسجَّلة بعد تحميل كود السحابة: 0
 *     خمسةٌ وسبعون نداءً على حدٍّ من ستّين:      لا ردّ
 *
 * والآلية مفهومة: `define` ينادي `addRateLimit(route, appId, true)`، وهي تفعل
 * `config = Config.get(appId)` — و**`Config.get` يبني كائناً جديداً في كل
 * نداء**. وكود السحابة يُحمَّل **قبل** أن يُنشئ الإقلاع مصفوفة `rateLimits` في
 * المخزون (`ParseServer.app` يبدأ بـ`rateLimit = []` فلا تدور حلقتُه)، فتصير
 * `config.rateLimits = []` مصفوفةً على كائنٍ يُرمى — **ويُسجَّل الحدُّ في العدم**.
 *
 * وقِيس النقيض ليُثبت أن العلّة في التوقيت لا في الآلية: حدٌّ يُسجَّل **بعد**
 * الإقلاع يلتصق ويعمل —
 *
 *     قبل التسجيل المتأخّر: 1 · بعده: 2
 *     ستّة نداءات على حدٍّ من ثلاثة: 200 200 200 429 429 429
 *
 * **فالخلاصة:** الإنفاذ سليم، والتسجيل من كود السحابة ميّتٌ صامت. ولو شُحن
 * ذلك لكان أسوأ من لا حماية: مالكٌ يقرأ في المستودع أن الحدود مضبوطة،
 * وليست مضبوطة.
 *
 * فما يبقى هو الصواب: يُضبط من **إعدادات الخادم** — متغيّر البيئة
 * `PARSE_SERVER_RATE_LIMIT` أو حقلُه في لوحة Back4app. وهذا الملفّ مصدرُ
 * القيمة التي تُلصق هناك، ويطبعها `npm run deploy` جاهزةً.
 */

/**
 * `zone: 'user'` لا `ip`.
 *
 * الافتراض `ip`، وعُمان تصل من شبكات محمولةٍ خلف NAT: حيٌّ كامل قد يخرج
 * بعنوانٍ واحد، فحدٌّ على العنوان يقطع عن الناس ما لم يُسيئوا. والحدُّ على
 * المستخدم عادلٌ ويكفي للباقة.
 *
 * **والأرقام تُختار بحيث لا يبلغها إنسان.** ستّون قراءةً في الدقيقة أسرعُ من
 * أي إبهامٍ على شاشة، والعشرون كتابةً في خمس دقائق فوق كل استعمالٍ معقول —
 * وحدٌّ يقطع عن المستخدم الصادق أسوأ من لا حدّ.
 */
const READ = { requestCount: 60, requestTimeWindow: 60 * 1000 };
const WRITE = { requestCount: 20, requestTimeWindow: 5 * 60 * 1000 };

const TOO_MANY = 'طلباتٌ كثيرة في وقتٍ قصير — أمهِل قليلاً ثم أعِد المحاولة.';

/** أيُّ سياسةٍ لأيّ دالّة. */
const POLICY = {
  /* قراءاتٌ ثقيلة أو متكرّرة */
  searchMosques: READ,
  getNearbyMosques: READ,
  getNearbyOpportunities: READ,
  getMyMosques: READ,
  getMyClaims: READ,
  getMyInterests: READ,
  getRequestInterests: READ,
  getRequestContacts: READ,
  getMyNotifications: READ,
  getMosqueLedger: READ,
  getMosqueAuditTrail: READ,
  getMyProfile: READ,
  listApprovedContractors: READ,
  // تُنادى مع كل فتحةِ شاشةٍ تعرف الموقع — فهي بمعدّل القراءة لا الكتابة
  updateMyLocation: READ,

  /* كتاباتٌ تُنشئ صفوفاً دائمة أو تُحرّك دورة العمل */
  claimMosque: WRITE,
  confirmMosqueLocation: WRITE,
  createServiceRequest: WRITE,
  cancelServiceRequest: WRITE,
  expressInterest: WRITE,
  withdrawInterest: WRITE,
  assignWorker: WRITE,
  releaseAssignment: WRITE,
  startWork: WRITE,
  markWorkDone: WRITE,
  completeService: WRITE,
  markNotificationsRead: WRITE,
  setFavoriteMosque: WRITE,
  updateMyProfile: WRITE,
};

/**
 * الدوالُّ التي لا حدَّ لها — **ولكلٍّ سببُه مكتوباً** (القاعدة ٤٥).
 *
 * الحارس يمسح دوالَّ السحابة كلَّها ويشترط على كلٍّ منها **قراراً**: سياسةٌ
 * أعلاه، أو سطرٌ هنا. فدالّةٌ تُضاف غداً لا تمرّ في صمت.
 */
const UNLIMITED = {
  health: 'نبضٌ لا يلمس القاعدة، وهي أداةُ المراقبة نفسها',
  preflight: 'المفتاح الرئيس وحده، ولا يبلغه عميل',
  paymentWebhook: 'لا جلسة معها — و`zone: user` بلا معنى، وحدُّها يُسقط قيدَ مالٍ دُفع',
  initiateDonation: 'مسار المال معطَّل في المرحلة الأولى — يُراجَع يوم يُفعَّل',
  confirmDonation: 'مسار المال معطَّل في المرحلة الأولى — يُراجَع يوم يُفعَّل',
  payoutContractor: 'مشرفٌ وحده، ومسار المال معطَّل',
  refundDonation: 'مشرفٌ وحده، ومسار المال معطَّل',
  listPendingClaims: 'مشرفٌ وحده، ومراجعةُ طابورٍ متراكم دفعةً عملٌ مطلوب لا إساءة',
  reviewMosqueClaim: 'مشرفٌ وحده، ومراجعةُ طابورٍ متراكم دفعةً عملٌ مطلوب لا إساءة',
  listPendingContractors: 'مشرفٌ وحده، ومراجعةُ طابورٍ متراكم دفعةً عملٌ مطلوب لا إساءة',
  reviewContractor: 'مشرفٌ وحده، ومراجعةُ طابورٍ متراكم دفعةً عملٌ مطلوب لا إساءة',
};

/**
 * القيمة كما تُلصق في `PARSE_SERVER_RATE_LIMIT` أو في لوحة Back4app.
 *
 * ومعها بابُ الدخول (`/login`) و(`/users`) — وهما **ليسا دالّتَي سحابة**،
 * فلا سبيل إلى حدِّهما إلا من هنا. وعليهما تخمينُ كلمات المرور وإغراقُ
 * التسجيل، وهما أخطرُ من أي دالّة.
 */
function rateLimitConfig() {
  const routes = Object.entries(POLICY).map(([name, policy]) => ({
    requestPath: `/functions/${name}`,
    ...policy,
    zone: 'user',
    errorResponseMessage: TOO_MANY,
  }));

  return [
    // بابُ الدخول: عشرُ محاولاتٍ في الدقيقة من العنوان الواحد. و`zone: 'ip'`
    // هنا لا `user`: من يخمّن كلمةَ غيره لا جلسةَ له تُعرف بها.
    {
      requestPath: '/login',
      requestMethods: ['GET', 'POST'],
      requestCount: 10,
      requestTimeWindow: 60 * 1000,
      zone: 'ip',
      errorResponseMessage: 'محاولاتُ دخولٍ كثيرة — أمهِل دقيقةً ثم أعِد المحاولة.',
    },
    // التسجيل: خمسةُ حسابات في الساعة من العنوان الواحد. والحدُّ على المستخدم
    // لا معنى له هنا — لا مستخدمَ بعد.
    {
      requestPath: '/users',
      requestMethods: ['POST'],
      requestCount: 5,
      requestTimeWindow: 60 * 60 * 1000,
      zone: 'ip',
      errorResponseMessage: 'حساباتٌ كثيرة من هذا الاتصال — أمهِل قليلاً.',
    },
    ...routes,
  ];
}

module.exports = { READ, WRITE, POLICY, UNLIMITED, rateLimitConfig };
