import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { storage } from "./lib/storage.js";

// recharts تُحمَّل عند الوصول لشاشة «القراءة» فقط — انظر التعليق في CashflowChart.jsx
const CashflowChart = lazy(() => import("./CashflowChart.jsx"));

// الهوية البصرية "Horizon Financial" من مشروع Stitch — نظام تصميم مُعَدّ لهذا التطبيق تحديداً.
const T = {
  paper:"#F8F9FB", card:"#FFFFFF", ink:"#1A2B48", ink2:"#44474D",
  muted:"#75777E", line:"#E5E7EB", fill:"#FEF6DC", fillLine:"#FBBF24",
  good:"#10B981", bad:"#EF4444", accent:"#3F51B5",
  display:"'IBM Plex Sans Arabic', system-ui, sans-serif",
  body:"'IBM Plex Sans Arabic', system-ui, sans-serif",
  mono:"'IBM Plex Sans', ui-monospace, monospace",
};

const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const when = (m) => `السنة ${Math.floor(m / 12) + 1} · ${MONTHS[m % 12]}`;

const CURRENCIES = [
  { code:"OMR", label:"ر.ع.", dec:3 }, { code:"AED", label:"د.إ", dec:2 },
  { code:"SAR", label:"ر.س", dec:2 }, { code:"KWD", label:"د.ك", dec:3 },
  { code:"QAR", label:"ر.ق", dec:2 }, { code:"BHD", label:"د.ب", dec:3 },
];

const Q = {
  stage: { q:"أين أنا في دورة حياتي المالية؟", theory:"فرضية دورة الحياة — موديلياني وبرومبيرغ.",
    o:[["build","التأسيس — بداية الدخل، صافي الثروة قرب الصفر أو سالب"],
       ["accum","التراكم — الدخل يفوق المصروف وأبني الأصول"],
       ["consol","التوطيد — ذروة الدخل، الأولوية حماية ما بُني"],
       ["spend","الإنفاق — أسحب من أصولي أكثر مما أضيف"],
       ["legacy","انتقال الثروة — التركيز على الإرث والوقف"]] },
  income: { q:"ما طبيعة دخلي؟", theory:"رأس المال البشري — إيبوتسون وميلفسكي: الدخل الثابت يشبه السند، والمتغيّر يشبه السهم.",
    o:[["fixed","ثابت شبه مضمون — وظيفة حكومية أو عقد طويل"],
       ["mixed","ثابت مع جزء متغيّر — عمولات أو بدلات"],
       ["var","متغيّر بالكامل — عمل حر أو مشروع خاص"],
       ["season","موسمي أو غير منتظم"]] },
  dependents: { q:"كم عدد من يعتمد عليّ مالياً؟", theory:"الادخار التحوّطي — كارول.",
    o:[["0","لا أحد"],["1","شخص أو شخصان"],["2","ثلاثة أو أربعة"],["3","خمسة فأكثر"]] },
  horizon: { q:"ما أفق أبعد هدف مالي لديّ؟", theory:"تخصيص الأصول حسب الأفق.",
    o:[["s","أقل من 3 سنوات"],["m","من 3 إلى 7 سنوات"],["l","من 7 إلى 15 سنة"],["xl","أكثر من 15 سنة"]] },
  priority: { q:"ما أولويتي المالية الآن؟", theory:"هرم التخطيط المالي: كل طبقة تسبق ما فوقها.",
    o:[["cover","تغطية المصروفات الأساسية أولاً"],["ef","بناء صندوق الطوارئ"],
       ["debt","سداد الديون مرتفعة الكلفة"],["ret","الادخار للتقاعد"],
       ["grow","الاستثمار للنمو"],["legacy","تخطيط الإرث والوقف"]] },
  debtMethod: { q:"كيف أسدّد ديوني؟", theory:"الانهيار الجليدي مقابل كرة الثلج.",
    o:[["avalanche","الأعلى فائدة أولاً — الأقل كلفة"],
       ["snowball","الأصغر رصيداً أولاً — الأسرع شعوراً بالإنجاز"],
       ["none","لا ديون عليّ"]] },
};
const QKEYS = ["stage","income","dependents","horizon","priority","debtMethod"];

const GOAL_TYPES = [
  ["","— اختر نوع الهدف —",""],
  ["ef","بناء صندوق الطوارئ","core"], ["debt","سداد دين قائم","core"],
  ["home_dp","الدفعة الأولى لمسكن","core"], ["home_buy","شراء أرض أو عقار","life"],
  ["car","شراء مركبة","life"], ["marriage","الزواج","life"],
  ["edu_self","تعليم أو شهادة مهنية لي","life"], ["edu_kids","تعليم الأبناء","core"],
  ["hajj","الحج أو العمرة","life"], ["travel","سفر","aspire"],
  ["business","تأسيس مشروع","aspire"], ["invest","ضخّ مبلغ في محفظة استثمارية","life"],
  ["retire","الادخار للتقاعد","core"], ["health","نفقة صحية متوقعة","core"],
  ["home_imp","تجديد المنزل أو أثاث","aspire"], ["waqf","وقف أو صدقة جارية","aspire"],
];
const GOAL_LABEL = Object.fromEntries(GOAL_TYPES.map((g) => [g[0], g[1]]));
const TIERS = [["core","أساسي — حاجة، تأجيله يضرّ"],["life","مهم — يرفع جودة الحياة"],["aspire","طموح — أتنازل عنه أولاً عند الضغط"]];
const TIER_LABEL = { core:"أساسي", life:"مهم", aspire:"طموح" };
const FUNDING = [
  ["","— كيفية التمويل —"],["auto","اقتطاع شهري تلقائي من الراتب"],["bonus","مكافأة أو علاوة سنوية"],
  ["side","دخل إضافي أو عمل حر"],["sell","بيع أصل قائم"],["loan","تمويل بنكي"],["gift","هبة أو إرث"],
];
const FUND_LABEL = Object.fromEntries(FUNDING.map((f) => [f[0], f[1]]));

const EXPENSES = [
  ["housing","الإيجار / القسط السكني","احتياج",0],["util","الكهرباء والماء","احتياج",0],
  ["comm","الاتصالات والإنترنت","احتياج",0],["food","التموين (البقالة)","احتياج",0],
  ["transp","المواصلات / وقود","احتياج",0],["ins","التأمين","احتياج",0],
  ["debt","أقساط القروض","احتياج",0],["edu","التعليم","احتياج",1],
  ["health","الصحة والعلاج","احتياج",0],["fun","الترفيه والمطاعم","رغبة",0],
  ["shop","التسوق والملابس","رغبة",0],["subs","الاشتراكات","رغبة",0],
  ["o1","بند آخر","رغبة",1],["o2","بند آخر","رغبة",1],
];
const INCOMES = [["الراتب الأساسي",0],["دخل إضافي / عمل حر",0],["عوائد استثمارات",1],["مصدر آخر",1]];
const ASSETS = [
  ["cash","السيولة النقدية / الحساب الجاري",0],["save","حساب التوفير",0],
  ["inv","الاستثمارات (أسهم / صناديق)",0],["ret","التقاعد / الادخار طويل المدى",0],
  ["prop","العقارات",0],["car","المركبات",0],["other","أصول أخرى",1],
];
const LIABS = [["قروض بنكية",0],["بطاقات ائتمان",0],["قرض عقاري",0],["قرض سيارة",0],["التزامات أخرى",1]];

// الافتراض الفقهي الشائع: السيولة والتوفير والاستثمارات القابلة للتداول زكوية،
// والعقار والمركبة الشخصيان والتقاعد غير المتاح حالياً ليست كذلك — قابل للتعديل يدوياً لكل حالة.
const ZAKAT_DEFAULT_FLAGS = () => ({ cash:true, save:true, inv:true, ret:false, prop:false, car:false, other:false });

const STORE_KEY = "khutta-maliya:v2";

// وضع الكوتش: فهرس عملاء منفصل عن بيانات كل خطة، كل خطة بمفتاح خاص بها.
const CLIENTS_KEY = "khutta-maliya:clients-v1";
const ACTIVE_CLIENT_KEY = "khutta-maliya:active-v1";
const planKey = (clientId) => `khutta-maliya:plan:${clientId}`;

const blank = () => ({
  cur:"OMR", age:0,
  stage:"", income:"", dependents:"", horizon:"", priority:"", debtMethod:"",
  ans:{}, goals:[], debts:[], debtExtra:0, inflation:2.5,
  assets: ASSETS.map(() => 0), liabs: LIABS.map(() => 0),
  exp: EXPENSES.map(([k, l, t]) => ({ key:k, label:l, type:t, cost:0 })),
  inc: INCOMES.map(([l]) => ({ label:l, amount:0 })),
  efNow:0, efOverride:0,
  zakat: { flags: ZAKAT_DEFAULT_FLAGS(), nisab:0, hawl:true },
});

const migrate = (raw) => {
  const o = { ...blank(), ...raw, ans: raw.ans || {} };
  if (Array.isArray(raw.months) && !Array.isArray(raw.goals)) {
    o.goals = raw.months.map((m, i) => ({ ...m, m:i })).filter((g) => g.type || g.cost > 0)
      .map((g, k) => ({ id:`m${k}`, m:g.m, type:g.type || "", tier:g.tier || "", cost:g.cost || 0, fund:g.fund || "" }));
  }
  if (!Array.isArray(o.debts)) o.debts = [];
  o.zakat = {
    flags: { ...ZAKAT_DEFAULT_FLAGS(), ...((raw.zakat && raw.zakat.flags) || {}) },
    nisab: (raw.zakat && raw.zakat.nisab) || 0,
    hawl: raw.zakat ? raw.zakat.hawl !== false : true,
  };
  delete o.months; delete o.lik; delete o.ch; delete o.risk;
  return o;
};
const CATS = {
  plan: { l:"الوعي والتخطيط", s:"تخطيط", col:"#0F8A6A" },
  safe: { l:"الأمان والحماية", s:"أمان",  col:"#3D6E8C" },
  grow: { l:"النمو والاستثمار", s:"نمو",  col:"#5B8C3D" },
  now:  { l:"اللحظة والاندفاع", s:"اندفاع", col:"#C2703D" },
  face: { l:"المكانة والمقارنة", s:"مكانة", col:"#B0508A" },
  give: { l:"العطاء والالتزام الأسري", s:"عطاء", col:"#8A6BB0" },
  hide: { l:"التجنّب والتأجيل", s:"تجنّب", col:"#7A8A85" },
};

const CARDS = [
  { id:"c1", t:"نزل الراتب", q:"الساعة اثنتا عشرة ليلاً ووصلك إشعار الراتب. أول شيء تفعله؟", o:[
    { t:"أحوّل حصة الادخار قبل أي مصروف", c:"plan" },
    { t:"أطمئن على الرصيد وأقفل التطبيق", c:"safe" },
    { t:"أعزم أهلي على عشاء", c:"give" },
    { t:"ما أفتحه — بيروح على كيفه", c:"hide" }]},

  { id:"c2", t:"زيادة في الراتب", q:"ارتفع راتبك عشرة بالمئة اعتباراً من هذا الشهر. ماذا يحدث للفرق؟", o:[
    { t:"أرفع الادخار بنفس النسبة قبل أن أعتاد عليه", c:"plan" },
    { t:"أضخّه في استثمار طويل الأجل", c:"grow" },
    { t:"أحسّن مستوى معيشتي — سكن أو سيارة", c:"face" },
    { t:"أوسّع على أهلي ومن حولي", c:"give" }]},

  { id:"c3", t:"مبلغ لم تتوقعه", q:"نزل في حسابك عشرة آلاف ريال فجأة. التصرف الأول؟", o:[
    { t:"أسدّد كل ما عليّ من دين", c:"plan" },
    { t:"أضعها في التوفير ولا ألمسها", c:"safe" },
    { t:"أستثمرها كاملة", c:"grow" },
    { t:"أشتري شيئاً أريده من زمان", c:"now" }]},

  { id:"c4", t:"عرض ينتهي بعد ساعتين", q:"شيء تريده من زمان، والسعر نزل، وليس في خطة هذا الشهر.", o:[
    { t:"أضيفه لخطة الشهر القادم", c:"plan" },
    { t:"أبحث عن بديل أرخص أو مستعمل", c:"safe" },
    { t:"أشتريه فوراً — الفرصة لا تتكرر", c:"now" },
    { t:"أشتريه لأن أغلب من حولي اقتناه", c:"face" }]},

  { id:"c5", t:"صديق يطلب قرضاً", q:"صديق مقرّب طلب منك خمسمئة ريال، ووعد بالسداد بعد شهرين.", o:[
    { t:"أعطيه مبلغاً أستطيع خسارته وأوضّح ذلك", c:"plan" },
    { t:"أعتذر بلطف — لا فائض عندي الآن", c:"safe" },
    { t:"أعطيه كاملاً، هذا واجب لا يُناقش", c:"give" },
    { t:"أماطل في الرد حتى ينسى", c:"hide" }]},

  { id:"c6", t:"المحفظة نزلت", q:"استثمارك انخفض عشرين بالمئة خلال شهر واحد.", o:[
    { t:"أراجع أرقامي وأقرّر بناءً على خطتي لا على الخبر", c:"plan" },
    { t:"أبيع وأحمي ما تبقّى", c:"safe" },
    { t:"أشتري المزيد بسعر أقل", c:"grow" },
    { t:"لا أفتح المحفظة أصلاً هذه الفترة", c:"hide" }]},

  { id:"c7", t:"كشف الحساب", q:"وصلك كشف الحساب الشهري. ماذا تفعل به؟", o:[
    { t:"أفتحه فوراً وأراجع البنود بنداً بنداً", c:"plan" },
    { t:"أفتحه لأتأكد أنه لا يوجد خصم غريب", c:"safe" },
    { t:"لا يهمّني التفصيل ما دام الرصيد يكفي", c:"now" },
    { t:"أؤجّله لبكرة… وبكرة", c:"hide" }]},

  { id:"c8", t:"يوم متعب", q:"يوم ثقيل في العمل، وأنت في طريقك إلى البيت.", o:[
    { t:"على البيت مباشرة", c:"plan" },
    { t:"أطلب من التطبيق وأنا في السيارة", c:"now" },
    { t:"أشتري شيئاً لأهلي يخفّف عنهم وعنّي", c:"give" },
    { t:"أدخل مكاناً جميلاً وأنشر صورة", c:"face" }]},

  { id:"c9", t:"مناسبة بعد شهر", q:"عرس قريب لك. كم تعطي؟", o:[
    { t:"مبلغاً حدّدته مسبقاً وألتزم به", c:"plan" },
    { t:"بقدر ما أعطاني في مناسبتي", c:"give" },
    { t:"مبلغاً يليق بمقامي أمام الناس", c:"face" },
    { t:"أقترض إن احتجت — المناسبة لا تتكرر", c:"now" }]},

  { id:"c10", t:"صيانة مفاجئة", q:"سيارتك تحتاج صيانة بثمانمئة ريال هذا الأسبوع.", o:[
    { t:"أدفع من صندوق الطوارئ، لهذا بنيته", c:"safe" },
    { t:"أدفع بالبطاقة وأقسّطها", c:"now" },
    { t:"أفكّر جدياً في تبديلها بأحدث", c:"face" },
    { t:"أؤجّل الصيانة وأرى ما يحدث", c:"hide" }]},

  { id:"c11", t:"اشتراكات نائمة", q:"اكتشفت أربعة اشتراكات شهرية لم تستخدمها منذ أشهر.", o:[
    { t:"ألغيها اليوم وأحوّل المبلغ إلى ادخاري", c:"plan" },
    { t:"ألغي بعضها وأبقي ما قد أحتاجه", c:"safe" },
    { t:"ألغيها وأصرف الموفَّر على شيء أستمتع به", c:"now" },
    { t:"سألغيها… قريباً", c:"hide" }]},

  { id:"c12", t:"بعد خمس وعشرين سنة", q:"تقاعدك. أين أنت منه الآن؟", o:[
    { t:"أدّخر له مبلغاً ثابتاً منذ الآن", c:"plan" },
    { t:"مستثمر بأدوات نمو طويلة الأجل", c:"grow" },
    { t:"أعتمد على أن أبنائي أو العقار يكفونني", c:"give" },
    { t:"لم أفكّر فيه بجدية بعد", c:"hide" }]},

  /* بطاقتا المفاضلة الزمنية — نفس الشكل، ووظيفتهما المقارنة بين إجابتيك */
  { id:"t1", trap:"time", t:"تنتظر شهراً؟", q:"أمامك مئة ريال اليوم. كم يجب أن يزيد المبلغ حتى تقبل الانتظار شهراً واحداً؟", o:[
    { t:"أنتظر مقابل 105", c:"plan" },
    { t:"أنتظر مقابل 115", c:"plan" },
    { t:"أنتظر مقابل 130", c:"now" },
    { t:"آخذ المئة اليوم مهما كانت الزيادة", c:"now" }]},

  { id:"t2", trap:"time", t:"وتنتظر شهراً هنا؟", q:"أمامك مئة ريال بعد سنة. كم يجب أن يزيد المبلغ حتى تقبل الانتظار شهراً إضافياً؟", o:[
    { t:"أنتظر مقابل 105", c:"plan" },
    { t:"أنتظر مقابل 115", c:"plan" },
    { t:"أنتظر مقابل 130", c:"now" },
    { t:"آخذ المئة بعد سنة مهما كانت الزيادة", c:"now" }]},

  /* بطاقتا الإطار — نفس المبلغ من مصدرين */
  { id:"t3", trap:"frame", t:"ثلاثمئة جاءتك", q:"وصلتك مكافأة مفاجئة قدرها ثلاثمئة ريال.", o:[
    { t:"أنفقها — مال زائد", c:"now" },
    { t:"أنفق نصفها وأدّخر نصفها", c:"plan" },
    { t:"أدّخرها كاملة", c:"safe" },
    { t:"أعطيها لمن يحتاجها", c:"give" }]},

  { id:"t4", trap:"frame", t:"ثلاثمئة وفّرتها", q:"ألغيت اشتراكات فوفّرت ثلاثمئة ريال من مصروفك.", o:[
    { t:"أنفقها — مال زائد", c:"now" },
    { t:"أنفق نصفها وأدّخر نصفها", c:"plan" },
    { t:"أدّخرها كاملة", c:"safe" },
    { t:"أعطيها لمن يحتاجها", c:"give" }]},
];

const TYPES = {
  plan: { name:"الطيّار", sub:"الوعي والتخطيط",
    d:"تفصل بين اللحظة والقرار. رغباتك تمرّ بمصفاة قبل أن تصير مصروفاً، وهذا لا يعني أنك بخيل بل أنك تقرّر وأنت بارد لا وأنت منفعل.",
    good:"قرارك يصمد حين تتغيّر صياغة السؤال. الخصومات والعروض لا تحرّكك لأنك تحسب لا تشعر.",
    trap:"الإفراط في التحليل يؤجّل قرارات جيدة، والانضباط الشديد قد يجعلك تؤجّل العيش إلى أجل لا يأتي.",
    say:"أقدر أنتظر.",
    acts:["مراجعة ربعية تكفيك، لا شهرية.","خصّص بنداً للمتعة بلا شعور بالذنب.","وجّه طاقتك إلى تخصيص الأصول لا إلى تقليص الفواتير."] },

  safe: { name:"الحارس", sub:"الأمان والحماية",
    d:"الأمان عندك يسبق النمو. تحتفظ بسيولة أكثر مما يلزم، وتفضّل عائداً أقل مضموناً على عائد أعلى متذبذب.",
    good:"لا تنهار عند الصدمات. صندوق طوارئك جاهز قبل غيرك، ولا تُجبر على بيع أصل في أسوأ توقيت.",
    trap:"التضخّم يأكل ما تحرسه بهدوء. حماية رأس المال من التذبذب ليست حمايةً له من التآكل.",
    say:"ما أدري إيش بيصير بكرة.",
    acts:["حدّد سقفاً للسيولة الزائدة وما فوقه يُستثمَر.","ادخل السوق بمبالغ صغيرة منتظمة بدل قرار واحد كبير.","افصل بين الحذر وبين التجميد."] },

  grow: { name:"الباني", sub:"النمو والاستثمار",
    d:"تفكّر بأثر القرار بعد عشر سنوات لا بعد عشرة أيام، وتتحمّل التذبذب مقابل النمو.",
    good:"الوقت في صفّك، وأنت تستخدمه. الفائدة المركّبة تحتاج صبراً وأنت تملكه.",
    trap:"قد تستثمر قبل أن تؤمّن السيولة، فتُجبر على التسييل في أسوأ لحظة. والثقة العالية بعد فترة صعود تُقرأ خطأً على أنها مهارة.",
    say:"على المدى الطويل بيرجع.",
    acts:["أغلق صندوق الطوارئ قبل أي ضخّ إضافي.","وزّع بدل التركيز في فكرة واحدة.","اكتب سبب كل استثمار قبل الدخول، وراجعه لا تراجع السعر."] },

  now: { name:"المزاجي", sub:"اللحظة والاندفاع",
    d:"قرارك المالي يُتخذ في لحظة انفعال ثم يأتي العقل ليبرّره. هذه ليست ضعف إرادة بل فجوة بين حالتك الهادئة وحالتك المنفعلة.",
    good:"سرعتك في القرار تخدمك في الفرص الحقيقية، وسخاؤك يجعل من حولك مرتاحين معك.",
    trap:"ما تدّخره في ثلاثة أشهر قد يذهب في مساء واحد، ثم تلوم نفسك بدل أن تلوم التصميم.",
    say:"أستاهل، تعبت.",
    acts:["اقتطاع تلقائي يوم الراتب قبل أن يمرّ المال بيدك.","قاعدة ثمان وأربعين ساعة لأي شراء فوق مبلغ تحدّده أنت.","احذف بطاقتك المحفوظة من التطبيقات."] },

  face: { name:"الواجهة", sub:"المكانة والمقارنة",
    d:"إنفاقك إشارة قبل أن يكون حاجة. ما يقتنيه من حولك يدخل معادلتك، ومستوى ظهورك جزء من حساباتك.",
    good:"طموحك محرّك حقيقي. أنت تسعى وراء دخل أعلى ولا تكتفي، وهذا يبني مساراً مهنياً لا يبنيه القانع.",
    trap:"تضخّم نمط الحياة: كل زيادة دخل تُبتلع قبل أن تصل حسابك، فتعمل أكثر وتملك المقدار نفسه.",
    say:"هذا مستوانا.",
    acts:["ثبّت مصروفك عند كل زيادة دخل واحتفظ بالفرق.","اجعل الأصول لا المظاهر هي ما تقارن به نفسك.","راجع من تقارن نفسك بهم — أغلبهم مدين ولا تراه."] },

  give: { name:"المعطاء", sub:"العطاء والالتزام الأسري",
    d:"المال عندك أداة علاقة قبل أن يكون أداة تراكم. الأهل والمناسبات والواجبات بنود ثابتة في ميزانيتك لا استثناءات.",
    good:"شبكتك الاجتماعية أصل حقيقي، وهي في السياق الخليجي شبكة أمان لا تقدر بمال.",
    trap:"العطاء بلا سقف يجعلك آخر من يُخدَم في ميزانيتك، فتصل الستين بلا صافي ثروة رغم دخل جيد طويل.",
    say:"ما أقدر أرد.",
    acts:["حدّد سقفاً سنوياً للعطاء وعامله كبند لا كطارئ.","ادّخر لنفسك أولاً ثم أعطِ من الباقي.","التزم بالمبلغ قبل المناسبة لا داخلها."] },

  hide: { name:"المؤجِّل", sub:"التجنّب والتأجيل",
    d:"المشكلة ليست عدم اهتمامك، بل أن النظر إلى الأرقام مؤلم فتؤجّله. والتأجيل يريحك ساعة ويكلّفك سنة.",
    good:"وعيك بأنك تتجنّب هو أصعب خطوة، وقد قطعتها بمجرّد إجابتك بصدق هنا.",
    trap:"المشكلات الصغيرة تكبر في الظلام: رسوم واشتراكات وفوائد تتراكم بلا مقاومة لأن أحداً لا ينظر.",
    say:"بشوفه بعدين.",
    acts:["مراجعة عشر دقائق بموعد ثابت، لا جلسة طويلة لن تحدث.","تنبيهات آلية بدل الفحص اليدوي.","اجعل المراجعة الأولى بحضور طرف ثالث."] },
};

const SPLIT = {
  name:"الشخصان في جيب واحد", sub:"قرارك يتغيّر بتغيّر الصياغة",
  d:"لا يوجد فيك خلل، بل شخصان يتناوبان: واحد يخطّط ويدّخر، وآخر يقرّر في اللحظة. المشكلة أن الخطة يضعها الأول وينفّذها الثاني.",
  good:"قدرتك على البناء ثابتة — أنت فعلاً تدّخر. المسألة في الحفاظ لا في البناء.",
  trap:"دورة بناء ثم تفريغ تتكرّر كل بضعة أشهر، فتشعر أنك تدور في مكانك رغم جهدك الحقيقي.",
  say:"هالمرة بيكون فيه فرق.",
  acts:["أتمتة كاملة يوم الراتب — لا قرار شهرياً.","حساب منفصل للأهداف بلا بطاقة مرتبطة به.","سمِّ كل حساب باسم هدفه؛ استخدم المحاسبة الذهنية أداةً بدل مقاومتها."],
};

/* ─────────────────────────  helpers  ───────────────────────── */
const curOf = (c) => CURRENCIES.find((x) => x.code === c) || CURRENCIES[0];
const money = (n, c) => {
  const k = curOf(c);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits:k.dec }) + " " + k.label;
};
const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const pct = (n) => (isFinite(n) ? (n * 100).toFixed(1) + "%" : "—");

/* محاكاة سداد الديون — تُطبّق الحد الأدنى على كل دين شهرياً ثم توجّه الدفعة الإضافية
   حسب ترتيب الطريقة (الأعلى فائدة أولاً للانهيار الجليدي، الأصغر رصيداً أولاً لكرة الثلج). */
const DEBT_MAX_MONTHS = 600;
function simulateDebts(rows, extra, orderFn) {
  const list = rows.map((r) => ({ apr:Number(r.apr) || 0, min:Number(r.min) || 0, bal:Number(r.balance) || 0 }));
  let totalInterest = 0, months = 0;
  while (list.some((x) => x.bal > 0.01) && months < DEBT_MAX_MONTHS) {
    months++;
    for (const x of list) {
      if (x.bal <= 0.01) continue;
      const interest = x.bal * (x.apr / 100 / 12);
      totalInterest += interest;
      x.bal += interest;
      x.bal -= Math.min(x.min, x.bal);
    }
    let pool = extra;
    for (const x of [...list].filter((y) => y.bal > 0.01).sort(orderFn)) {
      if (pool <= 0) break;
      const pay = Math.min(pool, x.bal);
      x.bal -= pay; pool -= pay;
    }
  }
  const neverPaidOff = list.some((x) => x.bal > 0.01);
  const originalTotal = sum(rows.map((r) => r.balance));
  return { months:neverPaidOff ? null : months, totalInterest, totalPaid:originalTotal + totalInterest, neverPaidOff };
}
const DEBT_ORDER = {
  avalanche: (a, b) => b.apr - a.apr,
  snowball: (a, b) => a.bal - b.bal,
};

const fieldStyle = {
  width:"100%", background:T.fill, border:`1px solid ${T.fillLine}55`, borderRadius:4,
  padding:"10px 11px", fontFamily:T.body, fontSize:13.5, color:T.ink, outline:"none",
};

function Select({ value, onChange, options, plain, style }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...fieldStyle, ...(plain ? { background:"#fff", border:`1px solid ${T.line}` } : {}), ...style }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function NumberField({ value, onChange, placeholder = "0", style }) {
  const [txt, setTxt] = useState(value ? String(value) : "");
  const f = useRef(false);
  useEffect(() => { if (!f.current) setTxt(value ? String(value) : ""); }, [value]);
  return (
    <input inputMode="decimal" value={txt} placeholder={placeholder}
      onFocus={() => (f.current = true)}
      onBlur={() => { f.current = false; setTxt(value ? String(value) : ""); }}
      onChange={(e) => { const r = e.target.value.replace(/[^\d.]/g, ""); setTxt(r); onChange(parseFloat(r) || 0); }}
      style={{ ...fieldStyle, fontFamily:T.mono, textAlign:"right", direction:"ltr", ...style }} />
  );
}

function TextField({ value, onChange, placeholder }) {
  return <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />;
}

function Card({ children, style, className }) {
  return (
    <div className={className} style={{
      background:T.card, border:`1px solid ${T.line}`, borderRadius:8, padding:18,
      boxShadow:"0px 2px 4px rgba(26, 43, 72, 0.05)", ...style,
    }}>{children}</div>
  );
}

function Head({ eyebrow, title, sub }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontFamily:T.mono, fontSize:11, letterSpacing:1, color:T.fillLine, direction:"ltr", textAlign:"right" }}>{eyebrow}</div>
      <h2 style={{ fontFamily:T.display, fontSize:24, color:T.ink, margin:"4px 0 6px", fontWeight:700, lineHeight:1.5 }}>{title}</h2>
      {sub && <p style={{ fontSize:13.5, color:T.muted, margin:0, lineHeight:1.75 }}>{sub}</p>}
    </div>
  );
}

function Row({ k, v, col, bold, hint }) {
  // القاعدة الثابتة: كل خانة رقمية بخط الأرقام واتجاه ltr وبلا التفاف، وإلا
  // انقلب ترتيب الأرقام أو انكسر الرقم عبر سطرين.
  //
  // لكن Row يحمل أيضاً قيماً نصّية طويلة (وصف مرحلة دورة الحياة، تصنيف ستانلي).
  // تطبيق nowrap عليها كان يمدّها خارج الشاشة على الجوال (390px) — وهو المقاس
  // الذي يُملأ به التطبيق فعلاً. لذا تُعامَل الأرقام وحدها بتلك القاعدة:
  // قيمة تبدأ برقم وتبقى قصيرة = رقم («16,400 ر.ع.»، «37.9%»)، وما عداها نصّ
  // يلتفّ بحرّية باتجاه rtl الموروث («53,760 ر.ع. — دون المتوقّع لعمرك ودخلك»).
  const s = String(v ?? "");
  const hasNumber = /\d/.test(s);
  return (
    <div style={{ padding:"7px 0" }}>
      <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"baseline" }}>
        <span style={{ color:T.ink2, fontWeight:bold ? 600 : 400, fontSize:13.5 }}>{k}</span>
        <span style={{
          fontFamily:hasNumber ? T.mono : T.body,
          color:col || T.ink, fontWeight:bold ? 600 : 400, fontSize:13.5, minWidth:0,
          // اتجاه ltr إلزامي لأي قيمة فيها رقم. بدونه تُعيد خوارزمية bidi ترتيب
          // المقاطع الرقمية المفصولة بمحايدات، فيُعرض «65.7% / 16.8% / 17.5%»
          // مقلوباً — أي يقرأ الكوتش الاحتياجات 17.5٪ والادخار 65.7٪، عكس الواقع.
          // أما whiteSpace:nowrap فلا يُعاد: هو سبب تمدّد القيم الطويلة خارج شاشة
          // الجوال، والالتفاف لا يكسر رقماً أصلاً (لا فراغ داخل «53,760»).
          ...(hasNumber ? { direction:"ltr" } : { textAlign:"start" }),
        }}>{v}</span>
      </div>
      {hint && <div style={{ fontSize:11.5, color:T.muted, marginTop:3, lineHeight:1.6 }}>{hint}</div>}
    </div>
  );
}

function Ask({ spec, value, onChange, n }) {
  return (
    <div style={{ marginBottom:18 }}>
      <div style={{ display:"flex", gap:8, alignItems:"baseline", marginBottom:7 }}>
        <span style={{ fontFamily:T.mono, fontSize:11, color:T.fillLine }}>F{n}</span>
        <span style={{ fontSize:14, color:T.ink, fontWeight:600, lineHeight:1.5 }}>{spec.q}</span>
      </div>
      <Select value={value} onChange={onChange} options={[["", "— اختر —"], ...spec.o]} />
      <div style={{ fontSize:11.5, color:T.muted, marginTop:6, lineHeight:1.7, borderInlineStart:`2px solid ${T.line}`, paddingInlineStart:9 }}>{spec.theory}</div>
    </div>
  );
}

function RepSec({ title, children }) {
  return (
    <div className="rep-sec" style={{ marginBottom:22 }}>
      <div style={{ fontFamily:T.display, fontSize:14, fontWeight:700, borderBottom:`1px solid ${T.line}`, paddingBottom:6, marginBottom:10 }}>{title}</div>
      {children}
    </div>
  );
}

const btn = {
  padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12.5,
  fontFamily:"'IBM Plex Sans Arabic', sans-serif", background:"#fff",
  border:`1px solid ${T.line}`, color:T.ink2,
};

function ItemList({ items, values, onChange, extraLabel = "إظهار بنود إضافية" }) {
  const [more, setMore] = useState(items.some((it, i) => it.rare && values[i] > 0));
  const shown = items.map((it, i) => ({ ...it, i })).filter((it) => !it.rare || more);
  return (
    <>
      {shown.map((it) => (
        <div key={it.i} style={{ display:"grid", gridTemplateColumns:"1fr 130px", gap:10, alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:13.5, color:T.ink2 }}>{it.label}</div>
          <NumberField value={values[it.i]} onChange={(v) => onChange(it.i, v)} />
        </div>
      ))}
      {items.some((it) => it.rare) && !more && (
        <button onClick={() => setMore(true)} style={{ ...btn, marginTop:4 }}>{extraLabel}</button>
      )}
    </>
  );
}

/* بطاقة قرار */
function DecisionCard({ n, total, card, value, onPick, onSkip }) {
  return (
    <Card style={{ marginBottom:12, padding:0, overflow:"hidden" }}>
      <div style={{ background:T.ink, color:"#EAF2EE", padding:"12px 16px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontFamily:T.mono, fontSize:12, background:"#2C4A42", padding:"3px 8px", borderRadius:6 }}>
          {String(n).padStart(2, "0")}
        </span>
        <span style={{ fontFamily:T.display, fontSize:14, fontWeight:700 }}>{card.t}</span>
        <span style={{ marginInlineStart:"auto", fontSize:11, color:"#8FB3A8", fontFamily:T.mono }}>{n}/{total}</span>
      </div>
      <div style={{ padding:16 }}>
        <p style={{ fontSize:14, lineHeight:1.75, margin:"0 0 13px", color:T.ink }}>{card.q}</p>
        {card.o.map((op, i) => {
          const on = value === i;
          const cat = CATS[op.c];
          return (
            <button key={i} onClick={() => onPick(i)} style={{
              width:"100%", textAlign:"start", marginBottom:7, padding:"12px 13px", borderRadius:10,
              cursor:"pointer", fontFamily:T.body, fontSize:13.5, lineHeight:1.6,
              border:`1px solid ${on ? cat.col : T.line}`,
              background:on ? `${cat.col}12` : "#fff", color:T.ink,
              display:"flex", alignItems:"center", gap:10,
            }}>
              <span style={{
                width:9, height:9, borderRadius:9, flexShrink:0,
                background:on ? cat.col : T.line,
              }} />
              <span style={{ flex:1 }}>{op.t}</span>
              {on && <span style={{ fontSize:10.5, color:cat.col, whiteSpace:"nowrap" }}>{cat.s}</span>}
            </button>
          );
        })}
        <button onClick={onSkip} style={{ ...btn, marginTop:3, fontSize:12, color:T.muted }}>
          {value === undefined ? "تخطّي هذه البطاقة" : "إلغاء اختياري"}
        </button>
      </div>
    </Card>
  );
}

/* ─────────────────────────  دوال حساب صرفة (بلا React) ─────────────────────────
   مفصولة عن المكوّن كي يمكن تشغيلها لأي عميل أثناء التصدير الجماعي في وضع الكوتش،
   لا فقط للعميل المفتوح حالياً في الواجهة. */

function lbl(spec, v) {
  const o = spec.o.find((x) => x[0] === v);
  return o ? o[1] : "لم يُجب";
}

function computeIdentity(ans) {
  const counts = {}; Object.keys(CATS).forEach((k) => (counts[k] = 0));
  let n = 0;
  CARDS.forEach((card) => {
    const i = ans[card.id];
    if (i === undefined) return;
    n++; counts[card.o[i].c]++;
  });
  const P = {}; Object.keys(CATS).forEach((k) => (P[k] = n ? Math.round((counts[k] / n) * 100) : 0));
  const rank = Object.keys(CATS).sort((a, b) => counts[b] - counts[a]);

  const present = ans.t1 !== undefined && ans.t2 !== undefined && ans.t1 > ans.t2;
  const frame = ans.t3 !== undefined && ans.t4 !== undefined && ans.t3 !== ans.t4;
  const incons = present || frame;

  const total = CARDS.length;
  const ready = n >= Math.ceil(total * 0.6);
  const top = ready ? rank[0] : null;
  const second = ready ? rank[1] : null;
  const prof = !ready ? null : incons ? SPLIT : TYPES[top];
  return { counts, P, rank, present, frame, incons, done:n, total, ready, top, second, prof };
}

function computeCalc(d, horizon, idn) {
  const totalAssets = sum(d.assets), totalLiabs = sum(d.liabs);
  const net = totalAssets - totalLiabs;
  const invested = (d.assets[2] || 0) + (d.assets[3] || 0);

  const zakatableTotal = ASSETS.reduce((s, [k], i) => s + (d.zakat.flags[k] ? (d.assets[i] || 0) : 0), 0);
  const zakatMeetsNisab = d.zakat.nisab > 0 ? zakatableTotal >= d.zakat.nisab : null;
  const zakatDue = d.zakat.hawl && zakatMeetsNisab ? zakatableTotal * 0.025 : 0;

  const get = (k) => (d.exp.find((e) => e.key === k) || {}).cost || 0;
  const totalExp = sum(d.exp.map((e) => e.cost));
  const needs = sum(d.exp.filter((e) => e.type === "احتياج").map((e) => e.cost));
  const wants = sum(d.exp.filter((e) => e.type === "رغبة").map((e) => e.cost));
  const income = sum(d.inc.map((i) => i.amount));
  const surplus = income - totalExp;
  const savingsRate = income > 0 ? surplus / income : 0;
  const r503020 = income > 0 ? { needs:needs / income, wants:wants / income, save:surplus / income } : null;
  const dtiHousing = income > 0 ? get("housing") / income : 0;
  const dtiTotal = income > 0 ? (get("housing") + get("debt")) / income : 0;

  const base = { fixed:3, mixed:6, var:9, season:12 }[d.income] || 6;
  const behav = idn.ready && (idn.incons || idn.P.now >= 25) ? 1 : 0;
  const efRec = Math.min(12, base + (parseInt(d.dependents, 10) || 0) + behav);
  const efMonths = d.efOverride || efRec;
  const efTarget = needs * efMonths;
  const efGap = Math.max(efTarget - d.efNow, 0);
  const efCover = needs > 0 ? d.efNow / needs : 0;

  const annualIncome = income * 12;
  const expectedNet = (d.age * annualIncome) / 10;
  const netRatio = expectedNet > 0 ? net / expectedNet : 0;
  const netClass = expectedNet <= 0 ? "" : netRatio >= 2 ? "بانٍ متميّز للثروة" : netRatio >= 0.5 ? "بانٍ متوسط للثروة" : "دون المتوقّع لعمرك ودخلك";

  const annualExp = totalExp * 12;
  const fiTarget = annualExp * 25;
  const fiFor = (s) => {
    if (annualExp <= 0 || s <= 0) return null;
    let b = invested;
    for (let y = 1; y <= 60; y++) { b = b * 1.04 + s * 12; if (b >= fiTarget) return y; }
    return null;
  };
  const fiYears = fiFor(surplus);
  const fiPlus = fiFor(surplus + income * 0.05);

  const BANDS = ["0–20٪","20–40٪","40–60٪","60–75٪","75–90٪"];
  const hs = { s:0, m:1, l:2, xl:3 }[d.horizon];
  let equity = null;
  if (hs !== undefined && idn.ready) {
    const tilt = idn.P.grow >= idn.P.safe + 20 ? 3 : idn.P.grow >= idn.P.safe ? 2 : idn.P.safe >= idn.P.grow + 20 ? 0 : 1;
    equity = BANDS[Math.max(0, Math.min(4, Math.round((hs + tilt) * 0.72)))];
  }

  const inflRate = (d.inflation || 0) / 100;
  const nominalOf = (cost, m) => (cost || 0) * Math.pow(1 + inflRate, m / 12);
  const dueBy = {};
  d.goals.forEach((g) => { dueBy[g.m] = (dueBy[g.m] || 0) + nominalOf(g.cost, g.m); });
  let pot = 0, ef = efGap, efDone = efGap === 0 ? 0 : null, firstShort = null, worst = 0;
  const capYear = [0,0,0,0,0], costYear = [0,0,0,0,0];
  for (let i = 0; i < 60; i++) {
    const y = Math.floor(i / 12);
    let s = surplus;
    if (ef > 0 && s > 0) { const put = Math.min(ef, s); ef -= put; s -= put; if (ef === 0 && efDone === null) efDone = i; }
    pot += s; capYear[y] += s;
    const due = dueBy[i] || 0;
    if (due) { costYear[y] += due; pot -= due; if (pot < 0 && firstShort === null) firstShort = i; }
    if (pot < worst) worst = pot;
  }
  const efNever = efGap > 0 && efDone === null;

  const inH = d.goals.filter((g) => g.m < horizon);
  const goalsTotal = sum(inH.map((g) => g.cost));
  const goalsTotalNominal = sum(inH.map((g) => nominalOf(g.cost, g.m)));
  const goalsAllReal = sum(d.goals.map((g) => g.cost));
  const goalsAllNominal = sum(d.goals.map((g) => nominalOf(g.cost, g.m)));
  const byTier = ["core","life","aspire"].map((t) => sum(inH.filter((g) => g.tier === t).map((g) => g.cost)));
  // byTier مقيَّد بمرشّح الأفق في شاشة الأهداف (سنة/ثلاث/خمس) — وهو مرشّح عرض.
  // التقرير لا يجوز أن يتغيّر بتغيّره، خصوصاً أن التصدير الجماعي يمرّر 60 دائماً،
  // فيخرج للعميل الواحد تقريران مختلفان. لذا للتقرير نسخة غير مقيَّدة.
  const byTierAll = ["core","life","aspire"].map((t) => sum(d.goals.filter((g) => g.tier === t).map((g) => g.cost)));
  const untyped = d.goals.filter((g) => !g.type).length;
  const manualFunded = d.goals.filter((g) => g.fund && g.fund !== "auto").length;

  return { totalAssets, totalLiabs, net, invested, totalExp, needs, wants, income, surplus,
    savingsRate, r503020, dtiHousing, dtiTotal, efRec, efMonths, efTarget, efGap, efCover, behav,
    expectedNet, netClass, netRatio, fiTarget, fiYears, fiPlus, equity,
    capYear, costYear, efDone, efNever, firstShort, worstShort:-worst, endPot:pot,
    goalsTotal, goalsTotalNominal, goalsAllReal, goalsAllNominal, byTier, byTierAll, untyped, manualFunded, annualExp, nominalOf,
    zakatableTotal, zakatMeetsNisab, zakatDue };
}

function computeDebtPlan(debts, extra) {
  const rows = debts.filter((x) => (x.balance || 0) > 0);
  if (!rows.length) return null;
  const ex = Math.max(0, extra || 0);
  const totalMin = sum(rows.map((r) => r.min));
  const totalBalance = sum(rows.map((r) => r.balance));
  return {
    extra:ex, totalMin, totalBalance,
    avalanche: simulateDebts(rows, ex, DEBT_ORDER.avalanche),
    snowball: simulateDebts(rows, ex, DEBT_ORDER.snowball),
  };
}

function buildReport(d, c, idn, debtPlan, factsDone) {
  const M = (n) => money(n, d.cur);
  const F = [];
  const add = (lvl, t, det) => F.push({ lvl, t, det });

  if (c.income > 0 && c.surplus < 0)
    add("high","عجز شهري", `المصروفات تفوق الدخل بـ ${M(-c.surplus)}. ` + (c.wants > 0
      ? `بند الرغبات ${M(c.wants)} وهو أول ما يُراجع.`
      : "ولا يوجد بند رغبات يُقلَّص — العجز كلّه في الاحتياجات، فالمراجعة تبدأ من السكن والأقساط أو من رفع الدخل."));
  if (c.efNever) add("high","صندوق الطوارئ لا يكتمل أبداً","لا يوجد فائض شهري موجب، فالفجوة لا تُغلق مهما طال الأمد.");
  if (idn.incons)
    add("high","قرار يتغيّر بتغيّر الصياغة", [
      idn.present && "اشترط زيادة أكبر للانتظار حين كان الموعد اليوم، وقنع بأقل حين ابتعد الموعدان معاً — خصم مفرط (لايبسون).",
      idn.frame && "تعامل مع ثلاثمئة المكافأة بطريقة تختلف عن ثلاثمئة الوفر — محاسبة ذهنية (ثالر).",
    ].filter(Boolean).join(" "));
  if (d.priority === "grow" && c.efCover < 3)
    add("high","ترتيب أولويات معكوس","اختار الاستثمار للنمو قبل تأمين سيولة ثلاثة أشهر — مخالف لتسلسل هرم التخطيط.");
  if (c.needs > 0 && c.efCover < 3)
    add("high","تغطية طوارئ أقل من ثلاثة أشهر", `الرصيد يغطي ${c.efCover.toFixed(1)} شهراً مقابل ${c.efMonths} موصى بها.`);
  else if (c.needs > 0 && c.efCover < c.efMonths)
    add("med","صندوق الطوارئ دون الهدف", `يغطي ${c.efCover.toFixed(1)} شهراً من ${c.efMonths}. المتبقي ${M(c.efGap)}.`);
  if (c.firstShort !== null)
    add("high","الخطة تنكسر عند التنفيذ", `أول شهر يعجز: ${when(c.firstShort)}. أقصى عجز تراكمي ${M(c.worstShort)}. الحساب يخصم مساهمة الطوارئ أولاً.`);
  if (c.income > 0 && c.dtiTotal > 0.36)
    add("high","نسبة الدين تتجاوز 36٪", `السكن والأقساط ${pct(c.dtiTotal)} من الدخل مقابل سقف قاعدة 28/36.`);
  else if (c.income > 0 && c.dtiHousing > 0.28)
    add("med","نسبة السكن تتجاوز 28٪", `${pct(c.dtiHousing)} من الدخل.`);
  if (idn.ready && idn.P.hide >= 25)
    add("med","نمط تأجيل مرتفع", `${idn.P.hide}٪ من قراراته تجنّب. المتابعة الشهرية المطوّلة لن تُنفَّذ؛ الأنسب مراجعة قصيرة مجدولة.`);
  if (idn.ready && idn.P.face >= 25 && c.r503020 && c.r503020.wants > 0.25)
    add("med","إنفاق مدفوع بالمقارنة", `${idn.P.face}٪ مكانة مع رغبات ${pct(c.r503020.wants)} من الدخل — تضخّم نمط الحياة هو الخطر الأقرب.`);
  if (idn.ready && idn.P.give >= 30)
    add("med","عطاء بلا سقف", `${idn.P.give}٪ من قراراته عطاء والتزام أسري. البند يحتاج سقفاً سنوياً معلناً لا معالجة كل مرة كطارئ.`);
  if (idn.ready && idn.P.safe >= 40 && (d.horizon === "l" || d.horizon === "xl"))
    add("med","حماية تفوق ما يتطلبه الأفق", `${idn.P.safe}٪ أمان مع أفق طويل. الحماية من التذبذب ليست حمايةً من التضخّم.`);
  if (c.manualFunded > 0 && idn.ready && (idn.incons || idn.P.now >= 25))
    add("med","تمويل يدوي في ملف اندفاعي", `${c.manualFunded} هدف يعتمد على قرار شهري لا على اقتطاع تلقائي.`);
  if (d.debtMethod === "none" && c.totalLiabs > 0)
    add("med","تعارض في بيانات الدين", `أجاب بأنه بلا ديون بينما الالتزامات المسجّلة ${M(c.totalLiabs)}.`);
  if (c.r503020 && c.r503020.needs > 0.5) add("med","الاحتياجات تتجاوز 50٪", `${pct(c.r503020.needs)} من الدخل.`);
  if (c.r503020 && c.r503020.wants > 0.3) add("med","الرغبات تتجاوز 30٪", `${pct(c.r503020.wants)} من الدخل.`);
  if (c.income > 0 && c.surplus >= 0 && c.savingsRate < 0.2)
    add("med","معدل الادخار دون 20٪", `${pct(c.savingsRate)} مقابل الخُمس المستهدف.`);
  if (c.expectedNet > 0 && d.age >= 35 && c.netRatio < 0.5)
    add("med","صافي الثروة دون المتوقع", `${M(c.net)} مقابل ${M(c.expectedNet)} متوقعة لعمره ودخله.`);
  if (c.untyped > 0) add("low","أهداف بلا نوع محدَّد", `${c.untyped} هدف بتكلفة دون اختيار نوعه.`);
  if (!idn.ready) add("low","بطاقات القرار غير مكتملة", `${idn.done} من ${idn.total}.`);
  if (factsDone < 6) add("low","الوقائع غير مكتملة", `${factsDone} من 6.`);

  const A = [];
  if (c.income > 0 && c.surplus < 0) {
    // ثلاث حالات مختلفة جوهرياً، وكانت تُصاغ جملةً واحدة: «خفض الرغبات بمقدار X».
    // حين تكون الرغبات صفراً كانت تخرج «خفض الرغبات بمقدار 0»، وحين تكون أقل من
    // العجز كانت توهم أن خفضها يُغلقه بينما يبقى فرق غير مغطّى.
    const gap = -c.surplus;
    A.push(
      c.wants <= 0
        ? `العجز ${M(gap)} شهرياً كلّه في الاحتياجات ولا رغبات تُقلَّص — المدخل الوحيد رفع الدخل أو إعادة هيكلة أكبر بندين: السكن والأقساط.`
        : c.wants >= gap
          ? `إغلاق العجز أولاً: خفض الرغبات بمقدار ${M(gap)} شهرياً قبل أي التزام ادخاري.`
          : `خفض الرغبات كاملةً (${M(c.wants)}) لا يُغلق العجز — يبقى ${M(gap - c.wants)} شهرياً يتطلّب رفع الدخل أو مراجعة الاحتياجات.`);
  }
  else if (c.efGap > 0 && c.surplus > 0)
    A.push(`توجيه كامل الفائض ${M(c.surplus)} لصندوق الطوارئ — يكتمل في ${c.efDone !== null ? when(c.efDone) : "أبعد من خمس سنوات"}.`);
  if (idn.prof) idn.prof.acts.slice(0, 2).forEach((a) => A.push(a));
  if (c.firstShort !== null)
    A.push(
      `إعادة جدولة الأهداف حول ${when(c.firstShort)} أو خفضها بمقدار ${M(c.worstShort)}؛ ` +
      (c.byTierAll[2] > 0
        ? `تأجيل أهداف الطموح (${M(c.byTierAll[2])}) هو المدخل الأقل ضرراً.`
        : "ولا توجد أهداف طموح تُؤجَّل — كل الأهداف أساسية أو مهمة، فالمخرج تأخير موعد أقربها أو رفع الفائض لا حذفها."));
  const chosenPlan = debtPlan && debtPlan[d.debtMethod === "snowball" ? "snowball" : "avalanche"];
  if (chosenPlan && !chosenPlan.neverPaidOff)
    A.push(`سداد الديون بطريقة ${d.debtMethod === "snowball" ? "كرة الثلج" : "الانهيار الجليدي"} — تنتهي خلال ${chosenPlan.months < 12 ? `${chosenPlan.months} شهراً` : `${(chosenPlan.months / 12).toFixed(1)} سنة`} بفائدة إجمالية ${M(chosenPlan.totalInterest)}.`);
  else if (c.totalLiabs > 0)
    A.push(d.debtMethod === "snowball" ? "سداد الديون بترتيب الأصغر رصيداً أولاً، بما يوافق اختياره."
                                      : "سداد الديون بترتيب الأعلى فائدة أولاً — الأقل كلفة إجمالية.");
  if (debtPlan && debtPlan.avalanche.neverPaidOff && debtPlan.snowball.neverPaidOff)
    add("high","جدول الديون لن يُسدَّد بالدفعات الحالية", "الحد الأدنى مع الدفعة الإضافية الحالية لا يكفي لتغطية الفائدة المتراكمة على مدى 50 سنة.");

  const diag = [
    ["النمط المالي", idn.prof ? `${idn.prof.name} — ${idn.prof.sub}` : "لم تكتمل البطاقات"],
    ...Object.keys(CATS).map((k) => [CATS[k].l, idn.done ? `${idn.P[k]}٪` : "—"]),
    ["اتساق القرار", idn.incons ? "متغيّر بتغيّر الصياغة" : idn.ready ? "متّسق" : "—"],
    ["صافي الثروة", M(c.net)],
    ["المتوقع لعمره ودخله", c.expectedNet > 0 ? `${M(c.expectedNet)} — ${c.netClass}` : "يتطلب العمر والدخل"],
    ["الدخل / المصروف", `${M(c.income)} / ${M(c.totalExp)}`],
    ["الفائض الشهري", M(c.surplus)],
    ["معدل الادخار", c.income ? pct(c.savingsRate) : "—"],
    ["توزيع 50/30/20", c.r503020 ? `${pct(c.r503020.needs)} / ${pct(c.r503020.wants)} / ${pct(c.r503020.save)}` : "—"],
    ["السكن + الأقساط (سقف 36٪)", c.income ? pct(c.dtiTotal) : "—"],
    ["تغطية الطوارئ", c.needs ? `${c.efCover.toFixed(1)} شهراً من ${c.efMonths} موصى بها` : "—"],
    ["اكتمال صندوق الطوارئ", c.efGap === 0 ? "مكتمل" : c.efDone !== null ? when(c.efDone) : "لا يكتمل خلال الخطة"],
    ["أول شهر يعجز", c.firstShort !== null ? `${when(c.firstShort)} — عجز ${M(c.worstShort)}` : "لا عجز خلال الخطة"],
    ["نطاق الأصول النامية", c.equity || "—"],
    ["سنوات الاستقلال المالي", c.fiYears ? `${c.fiYears} سنة (هدف ${M(c.fiTarget)})` : c.surplus > 0 ? "أكثر من 60 سنة" : "لا فائض"],
    ...(debtPlan ? [["جدول سداد الديون", (() => {
      const chosen = debtPlan[d.debtMethod === "snowball" ? "snowball" : "avalanche"];
      return chosen.neverPaidOff ? "لن تُسدَّد بالدفعات الحالية" : `${chosen.months} شهراً — فائدة إجمالية ${M(chosen.totalInterest)}`;
    })()]] : []),
    ...(d.zakat.nisab > 0 ? [["الزكاة المستحقة", c.zakatDue > 0 ? M(c.zakatDue) : c.zakatMeetsNisab === false ? "دون النصاب" : "لم يكتمل الحول"]] : []),
  ];

  const profile = [
    ["العمر", d.age ? `${d.age} سنة` : "لم يُدخل"],
    ["مرحلة دورة الحياة", lbl(Q.stage, d.stage)],
    ["طبيعة الدخل", lbl(Q.income, d.income)],
    ["المعالون", lbl(Q.dependents, d.dependents)],
    ["أفق أبعد هدف", lbl(Q.horizon, d.horizon)],
    ["الأولوية المعلنة", lbl(Q.priority, d.priority)],
    ["طريقة سداد الدين", lbl(Q.debtMethod, d.debtMethod)],
  ];

  const goals = [...d.goals].sort((a, b) => a.m - b.m)
    .map((g) => [when(g.m), GOAL_LABEL[g.type] || "بلا نوع", TIER_LABEL[g.tier] || "—", M(g.cost), FUND_LABEL[g.fund] || "—"]);

  return { flags:F, actions:A.slice(0, 5), diag, profile, goals };
}

function buildReportHtml(d, c, idn, rep, factsDone) {
  const esc = (s) => String(s).replace(/[&<>]/g, (x) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[x]));
  // نفس قاعدة Row في الواجهة: أي قيمة فيها رقم تُعرض ltr. المستند هنا dir="rtl"،
  // فبدونها تقلب bidi ترتيب المقاطع الرقمية المفصولة بمحايدات — «توزيع 50/30/20»
  // تُقرأ معكوسة، و«الدخل / المصروف» يتبادلان. وهذا الملف هو ما يصل العميل
  // ويُطبع في الجلسة، فالخطأ فيه أخطر منه في الشاشة.
  const rows = (arr) => arr.map(([k, v]) =>
    `<tr><td class="k">${esc(k)}</td><td class="v${/\d/.test(String(v)) ? " n" : ""}">${esc(v)}</td></tr>`).join("");
  const lv = { high:"مرتفعة", med:"متوسطة", low:"منخفضة" };
  return `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">
<title>تقرير الخطة المالية</title><style>
body{font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;color:#191C1E;max-width:800px;margin:32px auto;padding:0 20px;line-height:1.7;background:#F8F9FB}
h1{font-size:24px;margin:0 0 4px;color:#1A2B48}h2{font-size:20px;font-weight:600;margin:26px 0 8px;border-bottom:2px solid #1A2B48;padding-bottom:5px;color:#1A2B48}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:7px 9px;border-bottom:1px solid #E5E7EB;text-align:right}
.k{color:#75777E}.v{font-weight:600}
.v.n{direction:ltr;font-family:'IBM Plex Sans',ui-monospace,monospace}
.f{padding:10px 12px;border-radius:8px;margin-bottom:7px;font-size:13px}
.high{background:#FEE2E2;border-right:3px solid #EF4444}.med{background:#FEF6DC;border-right:3px solid #FBBF24}
.low{background:#F3F4F6;border-right:3px solid #75777E}
.d{color:#75777E;font-size:12px;margin-top:3px}
ol{padding-right:18px;font-size:13px}li{margin-bottom:7px}
.meta{color:#75777E;font-size:12px;margin-bottom:20px}
.type{background:#1A2B48;color:#FFFFFF;padding:16px;border-radius:8px;margin-bottom:18px}
.dis{color:#75777E;font-size:11px;margin-top:26px;border-top:1px solid #E5E7EB;padding-top:10px}
@media print{body{margin:0;background:#fff}}
</style>
<h1>تقرير الخطة المالية</h1>
<div class="meta">تاريخ الإصدار ${new Date().toLocaleDateString("en-GB")} · العملة ${curOf(d.cur).label} · البطاقات ${idn.done}/${idn.total} · الوقائع ${factsDone}/6</div>
${idn.prof ? `<div class="type"><b>${esc(idn.prof.name)} — ${esc(idn.prof.sub)}</b>
<div style="font-size:12.5px;margin-top:7px;line-height:1.8">${esc(idn.prof.d)}</div>
<div style="font-size:12px;margin-top:9px;line-height:1.8"><b>قوّتك:</b> ${esc(idn.prof.good)}<br><b>فخّك:</b> ${esc(idn.prof.trap)}<br><b>الجملة التي تقولها:</b> «${esc(idn.prof.say)}»</div></div>` : ""}
<h2>الوقائع</h2><table>${rows(rep.profile)}</table>
<h2>المؤشرات</h2><table>${rows(rep.diag)}</table>
<h2>التنبيهات (${rep.flags.length})</h2>
${rep.flags.length ? rep.flags.map((f) => `<div class="f ${f.lvl}"><b>${esc(f.t)}</b> — خطورة ${lv[f.lvl]}<div class="d">${esc(f.det)}</div></div>`).join("") : "<p>لا تنبيهات.</p>"}
<h2>الخطوات التالية</h2>
${rep.actions.length ? `<ol>${rep.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : "<p>تُحدَّد بعد إدخال الميزانية.</p>"}
<h2>الأهداف المسجّلة (${rep.goals.length})</h2>
${rep.goals.length ? `<table><tr><th>الشهر</th><th>الهدف</th><th>التصنيف</th><th>التكلفة</th><th>التمويل</th></tr>
${rep.goals.map((g) => `<tr>${g.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</table>` : "<p>لا أهداف مسجّلة.</p>"}
<div class="dis">بطاقات القرار أداة تصنيفية استرشادية مستلهمة من نصوص المال (كلونتز)، والمحاسبة الذهنية (ثالر)، والخصم المفرط (لايبسون)، ومقياس اتجاهات المال (يامَوتشي وتمبلر). ليست أداة تشخيص نفسي معتمدة ولم تُقنَّن على عيّنة خليجية. بقية القواعد استرشادية وليست توصية استثمارية أو قانونية.</div>
</html>`;
}

function downloadFile(filename, content, mime) {
  const b = new Blob([content], { type:mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ─────────────────────────  app  ───────────────────────── */
export default function App() {
  const [d, setD] = useState(blank);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [view, setView] = useState("facts");
  const [horizon, setHorizon] = useState(60);
  const [status, setStatus] = useState("جارٍ التحميل…");
  const [confirming, setConfirming] = useState(false);
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [moreExp, setMoreExp] = useState(false);
  const loaded = useRef(false);

  // تحميل فهرس العملاء أولاً؛ لو لم يوجد فهرس بعد، يُرحَّل أي خطة قديمة محفوظة بالمفتاح
  // الأصلي الوحيد إلى «عميل 1» بدل أن تُفقَد عند تفعيل وضع تعدد العملاء لأول مرة.
  useEffect(() => {
    (async () => {
      let list = [];
      try {
        const r = await storage.get(CLIENTS_KEY);
        const parsed = JSON.parse(r.value);
        if (Array.isArray(parsed) && parsed.length) list = parsed;
      } catch {}

      if (!list.length) {
        let legacy = null;
        try { legacy = JSON.parse((await storage.get(STORE_KEY)).value); } catch {}
        const firstId = `cl-${Date.now()}`;
        list = [{ id:firstId, name:legacy ? "عميلي" : "عميل 1", updatedAt:Date.now() }];
        await storage.set(CLIENTS_KEY, JSON.stringify(list)).catch(() => {});
        await storage.set(planKey(firstId), JSON.stringify(migrate(legacy || {}))).catch(() => {});
      }

      let active = null;
      try { active = JSON.parse((await storage.get(ACTIVE_CLIENT_KEY)).value); } catch {}
      if (!active || !list.some((c) => c.id === active)) active = list[0].id;

      setClients(list);
      setClientId(active);
      try {
        const r = await storage.get(planKey(active));
        setD(migrate(JSON.parse(r.value)));
      } catch {
        setD(blank());
      }
      setStatus("محفوظة");
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current || !clientId) return;
    setStatus("جارٍ الحفظ…");
    const t = setTimeout(async () => {
      try { await storage.set(planKey(clientId), JSON.stringify(d)); setStatus("محفوظة"); }
      catch { setStatus("تعذّر الحفظ — البيانات في هذه الجلسة فقط"); }
    }, 700);
    return () => clearTimeout(t);
  }, [d, clientId]);

  const switchClient = useCallback((newId) => {
    if (!newId || newId === clientId) return;
    (async () => {
      setStatus("جارٍ التحميل…");
      try {
        const r = await storage.get(planKey(newId));
        setD(migrate(JSON.parse(r.value)));
      } catch {
        setD(blank());
      }
      setClientId(newId);
      setView("facts");
      setConfirming(false);
      setConfirmDeleteClient(false);
      storage.set(ACTIVE_CLIENT_KEY, JSON.stringify(newId)).catch(() => {});
    })();
  }, [clientId]);

  const addClient = useCallback(() => {
    (async () => {
      const newId = `cl-${Date.now()}`;
      const name = `عميل ${clients.length + 1}`;
      const next = [...clients, { id:newId, name, updatedAt:Date.now() }];
      setClients(next);
      await storage.set(CLIENTS_KEY, JSON.stringify(next)).catch(() => {});
      await storage.set(planKey(newId), JSON.stringify(blank())).catch(() => {});
      setD(blank());
      setClientId(newId);
      setView("facts");
      storage.set(ACTIVE_CLIENT_KEY, JSON.stringify(newId)).catch(() => {});
    })();
  }, [clients]);

  const renameClient = useCallback((cid, name) => {
    setClients((prev) => {
      const next = prev.map((c) => (c.id === cid ? { ...c, name:name || c.name } : c));
      storage.set(CLIENTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const deleteClient = useCallback((cid) => {
    setClients((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((c) => c.id !== cid);
      storage.set(CLIENTS_KEY, JSON.stringify(next)).catch(() => {});
      if (cid === clientId) switchClient(next[0].id);
      return next;
    });
    setConfirmDeleteClient(false);
  }, [clientId, switchClient]);

  const exportAllClients = useCallback(() => {
    (async () => {
      for (const client of clients) {
        try {
          const r = await storage.get(planKey(client.id));
          const cd = migrate(JSON.parse(r.value));
          const cid2 = computeIdentity(cd.ans || {});
          const cc = computeCalc(cd, 60, cid2);
          const cdp = computeDebtPlan(cd.debts, cd.debtExtra);
          const cFactsDone = QKEYS.filter((k) => cd[k]).length;
          const crep = buildReport(cd, cc, cid2, cdp, cFactsDone);
          const html = buildReportHtml(cd, cc, cid2, crep, cFactsDone);
          downloadFile(`تقرير-${client.name}.html`, html, "text/html;charset=utf-8");
        } catch {}
        await new Promise((res) => setTimeout(res, 350));
      }
      setStatus(`تم تصدير ${clients.length} تقريراً`);
    })();
  }, [clients]);

  const up = useCallback((p) => setD((s) => ({ ...s, ...p })), []);
  const pick = useCallback((cid, i) => setD((s) => {
    const a = { ...s.ans };
    if (i === null) delete a[cid]; else a[cid] = i;
    return { ...s, ans:a };
  }), []);
  const upGoal = useCallback((id, p) => setD((s) => ({ ...s, goals:s.goals.map((g) => (g.id === id ? { ...g, ...p } : g)) })), []);
  const delGoal = useCallback((id) => setD((s) => ({ ...s, goals:s.goals.filter((g) => g.id !== id) })), []);
  const addGoal = useCallback(() => setD((s) => {
    const used = new Set(s.goals.map((g) => g.m));
    let m = 0; while (used.has(m) && m < 59) m++;
    return { ...s, goals:[...s.goals, { id:`g${Date.now()}${Math.random().toString(36).slice(2,6)}`, m, type:"", tier:"", cost:0, fund:"" }] };
  }), []);

  const upZakat = useCallback((p) => setD((s) => ({ ...s, zakat:{ ...s.zakat, ...p } })), []);
  const toggleZakatFlag = useCallback((key) => setD((s) => ({ ...s, zakat:{ ...s.zakat, flags:{ ...s.zakat.flags, [key]:!s.zakat.flags[key] } } })), []);

  const upDebt = useCallback((id, p) => setD((s) => ({ ...s, debts:s.debts.map((x) => (x.id === id ? { ...x, ...p } : x)) })), []);
  const delDebt = useCallback((id) => setD((s) => ({ ...s, debts:s.debts.filter((x) => x.id !== id) })), []);
  const addDebt = useCallback(() => setD((s) => ({
    ...s, debts:[...s.debts, { id:`b${Date.now()}${Math.random().toString(36).slice(2,6)}`, label:"", balance:0, apr:0, min:0 }],
  })), []);

  /* ── نتيجة البطاقات، المحرّك الحسابي، وجدول الديون — دوال صرفة مستخرجة أعلى الملف ── */
  const id = useMemo(() => computeIdentity(d.ans || {}), [d.ans]);
  const c = useMemo(() => computeCalc(d, horizon, id), [d, horizon, id]);
  const debtPlan = useMemo(() => computeDebtPlan(d.debts, d.debtExtra), [d.debts, d.debtExtra]);

  const factsDone = QKEYS.filter((k) => d[k]).length;

  const NAV = [["facts","الوقائع"],["identity","بطاقات القرار"],["goals","الأهداف"],["wealth","صافي الثروة"],["budget","الميزانية"],["safety","الكرامة المالية"],["summary","القراءة"],["report","تقرير الكوتش"]];
  const nextView = () => {
    const i = NAV.findIndex(([k]) => k === view);
    if (i < NAV.length - 1) { setView(NAV[i + 1][0]); window.scrollTo({ top:0 }); }
  };

  /* ── التقرير ── */
  const rep = useMemo(() => buildReport(d, c, id, debtPlan, factsDone), [d, c, id, factsDone, debtPlan]);

  const exportJson = () => {
    try { downloadFile("الخطة-المالية.json", JSON.stringify(d, null, 2), "application/json"); }
    catch { setStatus("تعذّر التصدير في هذه البيئة"); }
  };

  const exportHtml = () => {
    try {
      downloadFile("تقرير-الخطة-المالية.html", buildReportHtml(d, c, id, rep, factsDone), "text/html;charset=utf-8");
      setStatus("نُزّل التقرير — افتحه في المتصفح واحفظه PDF");
    } catch { setStatus("تعذّر التنزيل في هذه البيئة"); }
  };

  const doPrint = () => { try { window.print(); } catch { setStatus("الطباعة محجوبة — استخدم زر تنزيل التقرير"); } };
  const reset = () => { const f = blank(); setD(f); setConfirming(false); storage.set(planKey(clientId), JSON.stringify(f)).catch(() => {}); };
  const sortedGoals = useMemo(() => [...d.goals].sort((a, b) => a.m - b.m), [d.goals]);

  return (
    <div dir="rtl" style={{ background:T.paper, minHeight:"100vh", fontFamily:T.body, color:T.ink }}>
      <style>{`
        input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(63, 81, 181, 0.15); }
        input::placeholder { color: #A9B7B2; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

        /* الجوال (390px) هو المقاس الفعلي للاستخدام: العميل يملأ خطته على هاتفه.
           الشبكات ذات الأعمدة الثابتة تخنق الحقول عنده — اسم البند يُبتر، وخانة
           الرصيد تعرض «50» بدل «5000». الحل: التسمية على سطر مستقل بعرض كامل،
           والأرقام تُصفّ تحتها. رأس جدول الديون يختفي لأن كل حقل يشرح نفسه
           بعنصره النائب. */
        @media (max-width: 520px) {
          .exp-row  { grid-template-columns: 1fr 92px !important; }
          .exp-row  > :first-child { grid-column: 1 / -1; }
          .debt-head { display: none !important; }
          .debt-row { grid-template-columns: 1fr 1fr !important; }
          .debt-row > :first-child { grid-column: 1 / -1; }
        }
        @media print {
          .no-print { display: none !important; }
          body, main { background: #fff !important; }
          .rep-card { border: none !important; padding: 0 !important; }
          .rep-sec { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ position:"sticky", top:0, zIndex:20 }}>
        <div style={{ background:T.ink, color:"#EAF2EE" }}>
          <div style={{ maxWidth:1120, margin:"0 auto", padding:"10px 16px", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <div style={{ fontFamily:T.display, fontSize:13, fontWeight:700, marginInlineEnd:"auto" }}>
              النظام المالي<span style={{ color:"#8FB3A8", fontWeight:400, fontSize:11.5 }}> · خطتي لخمس سنوات</span>
            </div>
            {[
              ["النمط", id.prof ? id.prof.name : "—", id.incons ? "#F3A0AC" : "#7FD9BC", true],
              ["صافي الثروة", money(c.net, d.cur), c.net >= 0 ? "#7FD9BC" : "#F3A0AC", false],
              ["معدل الادخار", c.income ? pct(c.savingsRate) : "—", c.savingsRate >= 0.2 ? "#7FD9BC" : "#E8B84B", false],
              ["شهور الأمان", c.needs ? c.efCover.toFixed(1) : "—", c.efCover >= c.efMonths ? "#7FD9BC" : "#E8B84B", false],
            ].map(([k, v, col, ar]) => (
              <div key={k} style={{ paddingInline:12, borderInlineStart:"1px solid #2C4A42" }}>
                <div style={{ fontSize:10.5, color:"#8FB3A8" }}>{k}</div>
                <div style={{ fontFamily:ar ? T.body : T.mono, fontSize:ar ? 13 : 14, color:col, direction:ar ? "rtl" : "ltr", textAlign:"right" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:T.fill, borderBottom:`1px solid ${T.fillLine}55` }}>
          <div style={{ maxWidth:1120, margin:"0 auto", padding:"8px 16px", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:11.5, color:"#9A7A18" }}>العميل</span>
            {renaming ? (
              <>
                <input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { renameClient(clientId, renameText.trim()); setRenaming(false); }
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  style={{ ...fieldStyle, width:170, padding:"5px 8px", fontSize:12.5 }}
                />
                <button onClick={() => { renameClient(clientId, renameText.trim()); setRenaming(false); }} style={{ ...btn, padding:"5px 10px", fontSize:12 }}>حفظ</button>
                <button onClick={() => setRenaming(false)} style={{ ...btn, padding:"5px 10px", fontSize:12 }}>إلغاء</button>
              </>
            ) : (
              <>
                <Select plain value={clientId || ""} onChange={switchClient}
                  options={clients.map((cl) => [cl.id, cl.name])} style={{ width:170, padding:"5px 8px", fontSize:12.5 }} />
                <button
                  onClick={() => { setRenameText((clients.find((cl) => cl.id === clientId) || {}).name || ""); setRenaming(true); }}
                  style={{ ...btn, padding:"5px 10px", fontSize:12 }}
                >إعادة تسمية</button>
              </>
            )}
            <button onClick={addClient} style={{ ...btn, padding:"5px 10px", fontSize:12 }}>+ عميل جديد</button>
            {confirmDeleteClient ? (
              <>
                <span style={{ fontSize:11.5, color:T.bad }}>حذف {(clients.find((cl) => cl.id === clientId) || {}).name}؟</span>
                <button onClick={() => deleteClient(clientId)} style={{ ...btn, padding:"5px 10px", fontSize:12, color:"#fff", background:T.bad, borderColor:T.bad }}>نعم، احذف</button>
                <button onClick={() => setConfirmDeleteClient(false)} style={{ ...btn, padding:"5px 10px", fontSize:12 }}>تراجع</button>
              </>
            ) : (
              clients.length > 1 && (
                <button onClick={() => setConfirmDeleteClient(true)} style={{ ...btn, padding:"5px 10px", fontSize:12, color:T.bad, borderColor:"#E9C8CE" }}>حذف العميل</button>
              )
            )}
            <span style={{ marginInlineStart:"auto", fontSize:11, color:T.muted }}>{clients.length} عميل</span>
            <button onClick={exportAllClients} style={{ ...btn, padding:"5px 10px", fontSize:12 }}>تصدير الكل</button>
          </div>
        </div>

        <div style={{ background:T.card, borderBottom:`1px solid ${T.line}` }}>
          <div style={{ maxWidth:1120, margin:"0 auto", padding:"0 8px", display:"flex", gap:2, overflowX:"auto" }}>
            {NAV.map(([k, l], i) => (
              <button key={k} onClick={() => setView(k)} style={{
                whiteSpace:"nowrap", background:"none", border:"none", cursor:"pointer", padding:"13px 12px",
                fontFamily:T.body, fontSize:13.5, color:view === k ? T.ink : T.muted,
                fontWeight:view === k ? 600 : 400,
                borderBottom:view === k ? `2px solid ${T.fillLine}` : "2px solid transparent",
              }}>
                <span style={{ fontFamily:T.mono, fontSize:10.5, color:T.fillLine, marginInlineEnd:6 }}>0{i + 1}</span>{l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main style={{ maxWidth:1120, margin:"0 auto", padding:"22px 16px 40px" }}>

        {view === "facts" && (
          <>
            <Head eyebrow="01 / FACTS" title="الوقائع"
              sub="ست حقائق لا رأي فيها. هذه تحدّد الأرقام: أشهر الطوارئ، سقف الدين، وترتيب الأولويات. أما كيف تتصرّف فعلاً بالمال فتكشفه البطاقات." />
            <div style={{ display:"flex", gap:6, marginBottom:18, alignItems:"center" }}>
              <div style={{ flex:1, height:6, borderRadius:999, background:"#E4EAE7", overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${(factsDone / 6) * 100}%`, background:T.good, transition:"width .3s" }} />
              </div>
              <span style={{ fontFamily:T.mono, fontSize:12, color:T.muted }}>{factsDone}/6</span>
            </div>
            <Card style={{ marginBottom:16 }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:12 }}>
                <div>
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>العمر</div>
                  <NumberField value={d.age} onChange={(v) => up({ age:v })} placeholder="مثال 32" />
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>الدخل الشهري</div>
                  <NumberField value={d.inc[0].amount} onChange={(v) => { const a = d.inc.slice(); a[0] = { ...a[0], amount:v }; up({ inc:a }); }} />
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>العملة</div>
                  <Select value={d.cur} onChange={(v) => up({ cur:v })} options={CURRENCIES.map((x) => [x.code, `${x.label} — ${x.code}`])} />
                </div>
              </div>
            </Card>
            <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))" }}>
              <Card>
                <Ask n={1} spec={Q.stage} value={d.stage} onChange={(v) => up({ stage:v })} />
                <Ask n={2} spec={Q.income} value={d.income} onChange={(v) => up({ income:v })} />
                <Ask n={3} spec={Q.dependents} value={d.dependents} onChange={(v) => up({ dependents:v })} />
              </Card>
              <Card>
                <Ask n={4} spec={Q.horizon} value={d.horizon} onChange={(v) => up({ horizon:v })} />
                <Ask n={5} spec={Q.priority} value={d.priority} onChange={(v) => up({ priority:v })} />
                <Ask n={6} spec={Q.debtMethod} value={d.debtMethod} onChange={(v) => up({ debtMethod:v })} />
              </Card>
            </div>
            <Card style={{ marginTop:16, background:"#F7FAF8" }}>
              <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:10 }}>ما الذي غيّرته إجاباتك</div>
              <Row k="أشهر الطوارئ الموصى بها" v={d.income ? `${c.efRec} أشهر` : "أجب عن F2 و F3"}
                hint={`أساس حسب طبيعة الدخل مضافاً إليه درجة عن شريحة المعالين${c.behav ? "، ودرجة إضافية بسبب ما رصدته البطاقات" : ""}.`} />
              <Row k="سقف أقساط الدين" v={c.income ? `${money(c.income * 0.36, d.cur)} شهرياً` : "أدخل الدخل أعلاه"}
                hint="قاعدة 28/36: السكن لا يتجاوز 28٪، ومجموع السكن والأقساط لا يتجاوز 36٪." />
              <Row k="أول ما ينبغي أن يُموَّل"
                v={d.priority === "grow" && c.efCover < 3 ? "صندوق الطوارئ قبل الاستثمار" : d.priority ? lbl(Q.priority, d.priority) : "أجب عن F5"} />
            </Card>
          </>
        )}

        {view === "identity" && (
          <>
            <Head eyebrow="02 / DECISION CARDS" title="بطاقات القرار"
              sub="ست عشرة بطاقة، أربعة خيارات لكل بطاقة، ولا إجابة صحيحة. اختر ما تفعله فعلاً لا ما تنوي فعله. تستطيع تخطّي أي بطاقة، والتحليل يظهر بعد عشر بطاقات." />

            <div style={{ display:"flex", gap:6, marginBottom:16, alignItems:"center" }}>
              <div style={{ flex:1, height:6, borderRadius:999, background:"#E4EAE7", overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${(id.done / id.total) * 100}%`, background:T.good, transition:"width .3s" }} />
              </div>
              <span style={{ fontFamily:T.mono, fontSize:12, color:T.muted }}>{id.done}/{id.total}</span>
            </div>

            {id.prof && (
              <>
                <Card style={{ marginBottom:12, background:T.ink, border:"none", color:"#EAF2EE" }}>
                  <div style={{ fontSize:11.5, color:"#8FB3A8" }}>نمطك المالي</div>
                  <div style={{ fontFamily:T.display, fontSize:24, fontWeight:700, margin:"3px 0 2px", color:id.incons ? "#F3A0AC" : "#7FD9BC" }}>{id.prof.name}</div>
                  <div style={{ fontSize:12.5, color:"#8FB3A8", marginBottom:10 }}>{id.prof.sub}</div>
                  <div style={{ fontSize:13, lineHeight:1.9, color:"#DCE9E4" }}>{id.prof.d}</div>
                </Card>

                <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", marginBottom:12 }}>
                  <Card>
                    <div style={{ fontSize:11.5, color:T.good, marginBottom:5, fontWeight:600 }}>قوّتك</div>
                    <div style={{ fontSize:13, lineHeight:1.85 }}>{id.prof.good}</div>
                  </Card>
                  <Card>
                    <div style={{ fontSize:11.5, color:T.bad, marginBottom:5, fontWeight:600 }}>فخّك المتكرّر</div>
                    <div style={{ fontSize:13, lineHeight:1.85 }}>{id.prof.trap}</div>
                  </Card>
                </div>

                <Card style={{ marginBottom:12, background:T.fill, borderColor:`${T.fillLine}77` }}>
                  <div style={{ fontSize:11.5, color:"#9A7A18", marginBottom:6, fontWeight:600 }}>الجملة التي تقولها لنفسك</div>
                  <div style={{ fontFamily:T.display, fontSize:17, lineHeight:1.7 }}>«{id.prof.say}»</div>
                </Card>

                <Card style={{ marginBottom:12 }}>
                  <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:10 }}>ثلاث خطوات تناسب نمطك</div>
                  <ol style={{ paddingInlineStart:18, margin:0, fontSize:13.5, lineHeight:2 }}>
                    {id.prof.acts.map((a, i) => <li key={i} style={{ marginBottom:5 }}>{a}</li>)}
                  </ol>
                </Card>

                {id.second && !id.incons && (
                  <Card style={{ marginBottom:12 }}>
                    <div style={{ fontSize:12, color:T.muted, marginBottom:4 }}>نمطك الثاني</div>
                    <div style={{ fontSize:13.5, lineHeight:1.85 }}>
                      <b>{TYPES[id.second].name}</b> — {CATS[id.second].l} بنسبة {id.P[id.second]}٪.
                      يظهر حين يضعف نمطك الأول، وغالباً في القرارات الكبيرة لا اليومية.
                    </div>
                  </Card>
                )}
              </>
            )}

            {id.done > 0 && (
              <Card style={{ marginBottom:16 }}>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:12 }}>توزيع قراراتك</div>
                {id.rank.filter((k) => id.counts[k] > 0).map((k) => (
                  <div key={k} style={{ marginBottom:11 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, marginBottom:4 }}>
                      <span>{CATS[k].l}</span>
                      <span style={{ fontFamily:T.mono, color:CATS[k].col, direction:"ltr" }}>{id.P[k]}٪</span>
                    </div>
                    <div style={{ height:9, borderRadius:999, background:"#EDF1EF", overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${id.P[k]}%`, background:CATS[k].col, transition:"width .3s" }} />
                    </div>
                  </div>
                ))}
              </Card>
            )}

            {(id.present || id.frame) && (
              <Card style={{ marginBottom:16, background:"#FBECEE", borderColor:"#E9C8CE" }}>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:8 }}>ما رصدته بطاقات المقارنة</div>
                {id.present && <Row k="البطاقتان 13 و14" v="قرار متغيّر" col={T.bad}
                  hint="اشترطت زيادة أكبر للانتظار حين كان الموعد اليوم، وقنعت بأقل حين ابتعد الموعدان معاً. الفارق الزمني نفسه — شهر واحد — لكن الثمن الذي طلبته اختلف. هذا الخصم المفرط، وهو سبب انهيار الخطط الطويلة عند لحظة التنفيذ." />}
                {id.frame && <Row k="البطاقتان 15 و16" v="قرار متغيّر" col={T.bad}
                  hint="ثلاثمئة المكافأة وثلاثمئة الوفر نفس المبلغ في نفس الجيب، لكنك تصرّفت بهما بطريقتين. هذه المحاسبة الذهنية عند ثالر: المال المكتسب فجأة يدخل حساباً ذهنياً أسهل إنفاقاً." />}
                <p style={{ fontSize:12, color:T.ink2, lineHeight:1.85, marginBottom:0, marginTop:10 }}>
                  هذا ليس عيباً بل معلومة تصميمية: ملفك يحتاج أتمتة وفصل حسابات، لا مزيداً من العزيمة.
                </p>
              </Card>
            )}

            {CARDS.map((card, i) => (
              <DecisionCard key={card.id} n={i + 1} total={CARDS.length} card={card}
                value={d.ans[card.id]}
                onPick={(k) => pick(card.id, k)}
                onSkip={() => pick(card.id, null)} />
            ))}

            <p style={{ fontSize:11, color:T.muted, lineHeight:1.8, marginTop:14 }}>
              البطاقات أداة تصنيفية استرشادية مستلهمة من نصوص المال (كلونتز)، والمحاسبة الذهنية (ثالر)،
              والخصم المفرط (لايبسون)، ومقياس اتجاهات المال (يامَوتشي وتمبلر). ليست أداة تشخيص نفسي معتمدة
              ولم تُقنَّن على عيّنة خليجية، فاقرأ نتيجتها مدخلاً للحوار لا حكماً.
            </p>
          </>
        )}

        {view === "goals" && (
          <>
            <Head eyebrow="03 / GOALS" title="الأهداف"
              sub="أضف ما تريد تحقيقه فقط. التصنيف إلى أساسي ومهم وطموح مأخوذ من نظرية المحفظة السلوكية (شيفرن وستاتمان)." />
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
              {[[12,"سنة واحدة"],[36,"ثلاث سنوات"],[60,"خمس سنوات"]].map(([n, l]) => (
                <button key={n} onClick={() => setHorizon(n)} style={{
                  padding:"7px 14px", borderRadius:999, cursor:"pointer", fontSize:13, fontFamily:T.body,
                  border:`1px solid ${horizon === n ? T.ink : T.line}`, background:horizon === n ? T.ink : T.card,
                  color:horizon === n ? "#fff" : T.ink2,
                }}>{l}</button>
              ))}
              <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:12.5, color:T.muted }}>
                معدّل التضخم المفترض
                <NumberField value={d.inflation} onChange={(v) => up({ inflation:v })} placeholder="2.5" style={{ width:70, padding:"6px 8px" }} />
                ٪ سنوياً
              </span>
              <span style={{ marginInlineStart:"auto", fontSize:13, color:T.muted, textAlign:"left" }}>
                بأسعار اليوم: <b style={{ fontFamily:T.mono, color:T.ink, direction:"ltr", display:"inline-block" }}>{money(c.goalsTotal, d.cur)}</b>
                <br />
                المتوقع وقت الشراء: <b style={{ fontFamily:T.mono, color:T.fillLine, direction:"ltr", display:"inline-block" }}>{money(c.goalsTotalNominal, d.cur)}</b>
              </span>
            </div>
            <p style={{ fontSize:11.5, color:T.muted, margin:"-6px 0 14px", lineHeight:1.7 }}>
              تكلفة كل هدف تُدخَل بأسعار اليوم، وتُضخَّم في المحاكاة والرسم البياني حسب المسافة الزمنية حتى موعده — الفرق بين الرقمين أعلاه هو أثر التضخم وحده.
            </p>

            {id.ready && (id.incons || id.P.now >= 25) && c.manualFunded > 0 && (
              <Card style={{ marginBottom:14, background:T.fill, borderColor:T.fillLine }}>
                <div style={{ fontSize:13, lineHeight:1.85 }}>
                  <b>من نمطك ({id.prof.name}):</b> {c.manualFunded} من أهدافك يعتمد على قرار شهري لا على اقتطاع تلقائي.
                  «الاقتطاع الشهري التلقائي» هو خيار التمويل الذي يصمد عند ملفك.
                </div>
              </Card>
            )}

            <Card style={{ marginBottom:14, display:"flex", gap:10, flexWrap:"wrap" }}>
              {["core","life","aspire"].map((t, i) => (
                <div key={t} style={{ flex:"1 1 140px", padding:12, borderRadius:10, background:"#F7FAF8" }}>
                  <div style={{ fontSize:12, color:T.muted }}>{TIER_LABEL[t]}</div>
                  <div style={{ fontFamily:T.mono, fontSize:16, direction:"ltr", textAlign:"right" }}>{money(c.byTier[i], d.cur)}</div>
                  <div style={{ fontSize:11, color:T.muted }}>{c.goalsTotal ? pct(c.byTier[i] / c.goalsTotal) : "—"} من الخطة</div>
                </div>
              ))}
            </Card>

            {sortedGoals.length === 0 && (
              <Card style={{ textAlign:"center", padding:30 }}>
                <p style={{ color:T.muted, fontSize:13.5, margin:"0 0 14px", lineHeight:1.8 }}>
                  لا أهداف بعد. ابدأ بهدف واحد — صندوق الطوارئ هو المدخل الطبيعي في أغلب الملفات.
                </p>
                <button onClick={addGoal} style={{ ...btn, background:T.ink, color:"#fff", borderColor:T.ink, padding:"10px 20px" }}>أضف هدفاً</button>
              </Card>
            )}

            {sortedGoals.filter((g) => g.m < horizon).map((g) => (
              <Card key={g.id} style={{ marginBottom:10, padding:14 }}>
                <div style={{ display:"grid", gap:8, gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))" }}>
                  <Select plain value={String(Math.floor(g.m / 12))} onChange={(v) => upGoal(g.id, { m:+v * 12 + (g.m % 12) })}
                    options={[0,1,2,3,4].map((y) => [String(y), `السنة ${y + 1}`])} />
                  <Select plain value={String(g.m % 12)} onChange={(v) => upGoal(g.id, { m:Math.floor(g.m / 12) * 12 + +v })}
                    options={MONTHS.map((mn, i) => [String(i), mn])} />
                  <div style={{ gridColumn:"1 / -1" }}>
                    <Select value={g.type} options={GOAL_TYPES.map((x) => [x[0], x[1]])}
                      onChange={(v) => { const def = (GOAL_TYPES.find((x) => x[0] === v) || [])[2] || ""; upGoal(g.id, { type:v, tier:g.tier || def }); }} />
                  </div>
                  <Select value={g.tier} options={[["", "— التصنيف —"], ...TIERS]} onChange={(v) => upGoal(g.id, { tier:v })} />
                  <NumberField value={g.cost} onChange={(v) => upGoal(g.id, { cost:v })} placeholder="التكلفة" />
                  <Select value={g.fund} options={FUNDING} onChange={(v) => upGoal(g.id, { fund:v })} />
                </div>
                <div style={{ display:"flex", alignItems:"center", marginTop:8 }}>
                  {g.m > 0 && d.inflation > 0 && g.cost > 0 && (
                    <span style={{ fontSize:11.5, color:T.muted }}>
                      المتوقع وقت الشراء بالتضخّم: <b style={{ fontFamily:T.mono, direction:"ltr", display:"inline-block" }}>{money(c.nominalOf(g.cost, g.m), d.cur)}</b>
                    </span>
                  )}
                  <button onClick={() => delGoal(g.id)} style={{ ...btn, padding:"5px 11px", fontSize:12, color:T.bad, borderColor:"#E9C8CE", marginInlineStart:"auto" }}>حذف</button>
                </div>
              </Card>
            ))}

            {sortedGoals.length > 0 && (
              <button onClick={addGoal} style={{ ...btn, width:"100%", padding:"12px", background:T.ink, color:"#fff", borderColor:T.ink, fontSize:13.5 }}>أضف هدفاً آخر</button>
            )}
          </>
        )}

        {view === "wealth" && (
          <>
            <Head eyebrow="04 / NET WORTH" title="صافي الثروة"
              sub="الأصول ناقص الالتزامات، مقارنةً بما هو متوقّع لعمرك ودخلك وفق معادلة ستانلي ودانكو." />
            <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))" }}>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:14 }}>الأصول</div>
                <ItemList items={ASSETS.map(([k, l, r]) => ({ label:l, rare:!!r }))} values={d.assets}
                  onChange={(i, v) => { const a = d.assets.slice(); a[i] = v; up({ assets:a }); }} />
                <div style={{ borderTop:`1px solid ${T.line}`, marginTop:12, paddingTop:10 }}>
                  <Row k="إجمالي الأصول" v={money(c.totalAssets, d.cur)} col={T.good} bold />
                </div>
              </Card>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:14 }}>الالتزامات</div>
                <ItemList items={LIABS.map(([l, r]) => ({ label:l, rare:!!r }))} values={d.liabs}
                  onChange={(i, v) => { const a = d.liabs.slice(); a[i] = v; up({ liabs:a }); }} />
                <div style={{ borderTop:`1px solid ${T.line}`, marginTop:12, paddingTop:10 }}>
                  <Row k="إجمالي الالتزامات" v={money(c.totalLiabs, d.cur)} col={T.bad} bold />
                </div>
              </Card>
            </div>
            <Card style={{ marginTop:16, background:T.ink, border:"none", color:"#EAF2EE" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                <div style={{ fontFamily:T.display, fontSize:15 }}>صافي الثروة</div>
                <div style={{ fontFamily:T.mono, fontSize:26, direction:"ltr", color:c.net >= 0 ? "#7FD9BC" : "#F3A0AC" }}>{money(c.net, d.cur)}</div>
              </div>
              {c.expectedNet > 0 && (
                <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #2C4A42", fontSize:12.5, color:"#B9D2C9", lineHeight:1.8 }}>
                  المتوقّع لعمرك ودخلك: <b style={{ fontFamily:T.mono, direction:"ltr", display:"inline-block" }}>{money(c.expectedNet, d.cur)}</b> — العمر × الدخل السنوي ÷ 10.
                  تصنيفك: <b style={{ color:"#EAF2EE" }}>{c.netClass}</b>.
                  {d.age < 35 && " المعادلة قاسية على من هم دون الخامسة والثلاثين لأنها لا تحتسب سنوات الدراسة ولا سداد الديون المبكر."}
                </div>
              )}
            </Card>

            <Card style={{ marginTop:16 }}>
              <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:6 }}>جدول سداد الديون</div>
              <p style={{ fontSize:12.5, color:T.muted, marginTop:0, marginBottom:14, lineHeight:1.75 }}>
                سجّل كل دين برصيده ونسبة فائدته السنوية وحدّه الأدنى، وقارن بين الانهيار الجليدي وكرة الثلج قبل أن تختار.
              </p>

              {d.debts.length === 0 ? (
                <p style={{ color:T.muted, fontSize:13.5, marginBottom:14 }}>لا ديون مسجّلة بالتفصيل بعد.</p>
              ) : (
                <div style={{ marginBottom:12 }}>
                  <div className="debt-head" style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 90px 1fr 60px", gap:8, marginBottom:6, fontSize:11, color:T.muted }}>
                    <span>الدين</span><span>الرصيد</span><span>فائدة٪</span><span>الحد الأدنى</span><span></span>
                  </div>
                  {d.debts.map((x) => (
                    <div key={x.id} className="debt-row" style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr 90px 1fr 60px", gap:8, alignItems:"center", marginBottom:8 }}>
                      <TextField value={x.label} placeholder="اسم الدين" onChange={(v) => upDebt(x.id, { label:v })} />
                      <NumberField value={x.balance} placeholder="الرصيد" onChange={(v) => upDebt(x.id, { balance:v })} />
                      <NumberField value={x.apr} placeholder="فائدة ٪" onChange={(v) => upDebt(x.id, { apr:v })} />
                      <NumberField value={x.min} placeholder="الحد الأدنى" onChange={(v) => upDebt(x.id, { min:v })} />
                      <button onClick={() => delDebt(x.id)} style={{ ...btn, padding:"6px 8px", fontSize:11.5, color:T.bad, borderColor:"#E9C8CE" }}>حذف</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={addDebt} style={{ ...btn, marginBottom:debtPlan ? 16 : 0 }}>+ أضف ديناً</button>

              {debtPlan && (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 140px", gap:10, alignItems:"center", marginBottom:14, marginTop:16, paddingTop:14, borderTop:`1px solid ${T.line}` }}>
                    <div style={{ fontSize:12.5, color:T.muted }}>دفعة إضافية شهرية فوق الحد الأدنى (إجماليه {money(debtPlan.totalMin, d.cur)})</div>
                    <NumberField value={d.debtExtra || 0} onChange={(v) => up({ debtExtra:v })} />
                  </div>
                  <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {[["avalanche", "الانهيار الجليدي", debtPlan.avalanche], ["snowball", "كرة الثلج", debtPlan.snowball]].map(([key, label, r]) => (
                      <div key={key} style={{
                        padding:14, borderRadius:10,
                        background:d.debtMethod === key ? T.fill : "#F7FAF8",
                        border:`1px solid ${d.debtMethod === key ? T.fillLine : T.line}`,
                      }}>
                        <div style={{ fontSize:12.5, fontWeight:600, marginBottom:8 }}>
                          {label} {d.debtMethod === key && <span style={{ fontSize:10.5, color:"#9A7A18" }}>— اختيارك</span>}
                        </div>
                        <Row k="مدة السداد" v={r.neverPaidOff ? "لن تُسدَّد بالدفعات الحالية" : r.months < 12 ? `${r.months} شهراً` : `${(r.months / 12).toFixed(1)} سنة`} />
                        <Row k="إجمالي الفائدة" v={r.neverPaidOff ? "—" : money(r.totalInterest, d.cur)} />
                        <Row k="إجمالي المسدَّد" v={r.neverPaidOff ? "—" : money(r.totalPaid, d.cur)} />
                      </div>
                    ))}
                  </div>
                  {!debtPlan.avalanche.neverPaidOff && !debtPlan.snowball.neverPaidOff && debtPlan.avalanche.totalInterest !== debtPlan.snowball.totalInterest && (
                    <p style={{ fontSize:12, color:T.ink2, marginTop:10, lineHeight:1.85 }}>
                      {debtPlan.avalanche.totalInterest < debtPlan.snowball.totalInterest
                        ? `الانهيار الجليدي يوفّر ${money(debtPlan.snowball.totalInterest - debtPlan.avalanche.totalInterest, d.cur)} من الفائدة مقارنة بكرة الثلج — هو الأقل كلفة رياضياً.`
                        : `كرة الثلج توفّر ${money(debtPlan.avalanche.totalInterest - debtPlan.snowball.totalInterest, d.cur)} من الفائدة هنا، وهذا نادر ويحدث عندما تتقارب نسب الفائدة وتتفاوت الأرصدة بشدة.`}
                      {" "}كرة الثلج تبقى الخيار الأنسب لمن يحتاج زخماً نفسياً بإغلاق دين كامل بسرعة، حتى لو كانت كلفتها أعلى بقليل.
                    </p>
                  )}
                  {(debtPlan.avalanche.neverPaidOff || debtPlan.snowball.neverPaidOff) && (
                    <p style={{ fontSize:12, color:T.bad, marginTop:10, lineHeight:1.85 }}>
                      الحد الأدنى مع الدفعة الإضافية الحالية لا يكفي لتغطية الفائدة المتراكمة — الديون لن تُسدَّد أبداً بهذا المستوى من الدفع. زِد الدفعة الإضافية أو راجع الفوائد المرتفعة أولاً.
                    </p>
                  )}
                </>
              )}
            </Card>

            <Card style={{ marginTop:16 }}>
              <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:6 }}>حاسبة الزكاة</div>
              <p style={{ fontSize:12.5, color:T.muted, marginTop:0, marginBottom:14, lineHeight:1.75 }}>
                2.5٪ على الأصول الزكوية إذا بلغت النصاب ومضى عليها الحول. حدّد أي فئات أصولك تعتبرها زكوية — الافتراض هنا
                هو الرأي الشائع (السيولة والتوفير والاستثمارات القابلة للتداول زكوية، والعقار والمركبة الشخصيان والتقاعد غير المتاح ليست كذلك)،
                وهو اجتهاد عام لا فتوى؛ عدّل حسب حالتك أو استشر مختصاً شرعياً.
              </p>

              <div style={{ marginBottom:14 }}>
                {ASSETS.map(([k, l], i) => (
                  <label key={k} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", fontSize:13, cursor:"pointer" }}>
                    <input type="checkbox" checked={!!d.zakat.flags[k]} onChange={() => toggleZakatFlag(k)} />
                    <span style={{ flex:1, color:T.ink2 }}>{l}</span>
                    <span style={{ fontFamily:T.mono, direction:"ltr", color:T.muted }}>{money(d.assets[i] || 0, d.cur)}</span>
                  </label>
                ))}
              </div>

              <div style={{ borderTop:`1px solid ${T.line}`, paddingTop:12, marginBottom:14 }}>
                <Row k="إجمالي الأصول الزكوية" v={money(c.zakatableTotal, d.cur)} bold />
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>قيمة النصاب بعملتك (595غم فضة أو 85غم ذهب — بسعر اليوم)</div>
                  <NumberField value={d.zakat.nisab || 0} onChange={(v) => upZakat({ nisab:v })} placeholder="أدخل من مصدر أسعار موثوق" />
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer", alignSelf:"end", paddingBottom:10 }}>
                  <input type="checkbox" checked={!!d.zakat.hawl} onChange={() => upZakat({ hawl:!d.zakat.hawl })} />
                  <span>مضى عليها حول كامل (سنة هجرية)</span>
                </label>
              </div>

              {d.zakat.nisab > 0 ? (
                <div style={{ padding:14, borderRadius:10, background:c.zakatDue > 0 ? T.fill : "#F7FAF8", border:`1px solid ${c.zakatDue > 0 ? T.fillLine : T.line}` }}>
                  <Row k="بلغت النصاب؟" v={c.zakatMeetsNisab ? "نعم" : "لا"} col={c.zakatMeetsNisab ? T.good : T.muted} />
                  <Row k="الزكاة المستحقة (2.5٪)" v={money(c.zakatDue, d.cur)} bold col={c.zakatDue > 0 ? "#9A7A18" : T.muted} />
                  {c.zakatMeetsNisab && !d.zakat.hawl && (
                    <p style={{ fontSize:11.5, color:T.muted, marginTop:8, marginBottom:0, lineHeight:1.7 }}>
                      بلغت النصاب لكن الحول لم يكتمل بعد حسب ما حدّدته — لا زكاة مستحقة الآن.
                    </p>
                  )}
                </div>
              ) : (
                <p style={{ fontSize:12.5, color:T.muted, margin:0 }}>أدخل قيمة النصاب أعلاه لحساب الزكاة المستحقة.</p>
              )}
            </Card>
          </>
        )}

        {view === "budget" && (
          <>
            <Head eyebrow="05 / BUDGET" title="المصروفات والميزانية"
              sub="التصنيف إلى احتياج ورغبة يُقاس مقابل قاعدة 50/30/20 من كتاب «كل ما تملك» لإليزابيث وارن." />
            <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(320px, 1fr))" }}>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:14 }}>المصروفات الشهرية</div>
                {d.exp.map((e, i) => ({ e, i })).filter(({ i }) => !EXPENSES[i][3] || moreExp || d.exp[i].cost > 0).map(({ e, i }) => (
                  <div key={i} className="exp-row" style={{ display:"grid", gridTemplateColumns:"1fr 110px 92px", gap:8, alignItems:"center", marginBottom:8 }}>
                    <TextField value={e.label} onChange={(v) => { const a = d.exp.slice(); a[i] = { ...a[i], label:v }; up({ exp:a }); }} />
                    <NumberField value={e.cost} onChange={(v) => { const a = d.exp.slice(); a[i] = { ...a[i], cost:v }; up({ exp:a }); }} />
                    <button onClick={() => { const a = d.exp.slice(); a[i] = { ...a[i], type:a[i].type === "احتياج" ? "رغبة" : "احتياج" }; up({ exp:a }); }}
                      style={{ padding:"10px 6px", borderRadius:8, cursor:"pointer", fontSize:12.5, fontFamily:T.body,
                        border:`1px solid ${e.type === "احتياج" ? T.good : T.fillLine}`,
                        background:e.type === "احتياج" ? "#E8F5F0" : T.fill,
                        color:e.type === "احتياج" ? T.good : "#9A7A18" }}>{e.type}</button>
                  </div>
                ))}
                {!moreExp && <button onClick={() => setMoreExp(true)} style={{ ...btn, marginTop:4 }}>إظهار بنود إضافية</button>}
                <div style={{ borderTop:`1px solid ${T.line}`, marginTop:12, paddingTop:10 }}>
                  <Row k="إجمالي المصروفات" v={money(c.totalExp, d.cur)} bold />
                  <Row k="منها احتياجات" v={money(c.needs, d.cur)} col={T.good} />
                  <Row k="منها رغبات" v={money(c.wants, d.cur)} col="#9A7A18" />
                </div>
              </Card>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:14 }}>مصادر الدخل</div>
                {d.inc.map((s, i) => ({ s, i })).filter(({ i }) => !INCOMES[i][1] || d.inc[i].amount > 0 || i < 2).map(({ s, i }) => (
                  <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 130px", gap:8, alignItems:"center", marginBottom:8 }}>
                    <TextField value={s.label} onChange={(v) => { const a = d.inc.slice(); a[i] = { ...a[i], label:v }; up({ inc:a }); }} />
                    <NumberField value={s.amount} onChange={(v) => { const a = d.inc.slice(); a[i] = { ...a[i], amount:v }; up({ inc:a }); }} />
                  </div>
                ))}
                <div style={{ borderTop:`1px solid ${T.line}`, marginTop:12, paddingTop:10 }}>
                  <Row k="إجمالي الإيرادات" v={money(c.income, d.cur)} bold />
                </div>
                <div style={{ marginTop:14, padding:16, borderRadius:12, background:c.surplus >= 0 ? "#E8F5F0" : "#FBECEE" }}>
                  <div style={{ fontSize:12.5, color:T.muted }}>{c.surplus >= 0 ? "فائض متاح للادخار" : "عجز — الرغبات أول ما يُراجع"}</div>
                  <div style={{ fontFamily:T.mono, fontSize:24, direction:"ltr", textAlign:"right", color:c.surplus >= 0 ? T.good : T.bad }}>{money(c.surplus, d.cur)}</div>
                </div>
                {c.r503020 && (
                  <div style={{ marginTop:16 }}>
                    <div style={{ fontSize:12.5, color:T.muted, marginBottom:8 }}>مقابل قاعدة 50/30/20</div>
                    {[["الاحتياجات", c.r503020.needs, 0.5],["الرغبات", c.r503020.wants, 0.3],["الادخار", c.r503020.save, 0.2]].map(([l, v, t], i) => {
                      const ok = i === 2 ? v >= t : v <= t;
                      return (
                        <div key={l} style={{ marginBottom:9 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, marginBottom:4 }}>
                            <span>{l} — المستهدف {pct(t)}</span>
                            <span style={{ fontFamily:T.mono, color:ok ? T.good : T.bad, direction:"ltr" }}>{pct(v)}</span>
                          </div>
                          <div style={{ height:7, borderRadius:999, background:"#EDF1EF", overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${Math.min(100, Math.max(0, v) * 100)}%`, background:ok ? T.good : T.bad }} />
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${T.line}` }}>
                      <Row k="نسبة السكن من الدخل" v={pct(c.dtiHousing)} col={c.dtiHousing <= 0.28 ? T.good : T.bad} />
                      <Row k="السكن + الأقساط" v={pct(c.dtiTotal)} col={c.dtiTotal <= 0.36 ? T.good : T.bad} hint="قاعدة 28/36 المستخدمة في الاكتتاب العقاري." />
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </>
        )}

        {view === "safety" && (
          <>
            <Head eyebrow="06 / SAFETY" title="الكرامة المالية — صندوق الطوارئ"
              sub="عدد الأشهر دالة على تقلّب دخلك وعدد من يعتمد عليك، ويضاف إليه هامش سلوكي حين ترصد البطاقات اندفاعاً أو تناقضاً." />
            {c.needs === 0 ? (
              <Card><p style={{ color:T.muted, fontSize:14, margin:0, lineHeight:1.8 }}>أدخل بنودك الأساسية في صفحة «الميزانية» أولاً، ثم عُد إلى هنا.</p></Card>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))" }}>
                <Card>
                  <Row k="المصروفات الأساسية الشهرية" v={money(c.needs, d.cur)} />
                  <div style={{ height:12 }} />
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>عدد أشهر التغطية</div>
                  <Select value={String(d.efOverride || 0)} onChange={(v) => up({ efOverride:+v })}
                    options={[["0", `الموصى به لملفك — ${c.efRec} أشهر`], ...[3,4,5,6,7,8,9,10,11,12].map((n) => [String(n), `${n} أشهر`])]} />
                  {c.behav > 0 && (
                    <div style={{ fontSize:11.5, color:"#9A7A18", marginTop:7, lineHeight:1.75 }}>
                      شهر إضافي لأن بطاقاتك أظهرت اندفاعاً أو قراراً متغيّراً — الهامش هنا يعوّض تسرّباً متوقّعاً، لا تقلّب دخل.
                    </div>
                  )}
                  <div style={{ height:14 }} />
                  <Row k="هدف صندوق الطوارئ" v={money(c.efTarget, d.cur)} bold />
                  <div style={{ height:10 }} />
                  <div style={{ fontSize:12, color:T.muted, marginBottom:6 }}>الرصيد الحالي</div>
                  <NumberField value={d.efNow} onChange={(v) => up({ efNow:v })} />
                  <div style={{ height:12 }} />
                  <Row k="المتبقي للهدف" v={money(c.efGap, d.cur)} col={c.efGap > 0 ? T.bad : T.good} bold />
                  <div style={{ marginTop:12, height:10, borderRadius:999, background:"#EDF1EF", overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${Math.min(100, c.efTarget ? (d.efNow / c.efTarget) * 100 : 0)}%`, background:T.good, transition:"width .3s" }} />
                  </div>
                  <div style={{ fontSize:12, color:T.muted, marginTop:8 }}>
                    رصيدك يغطي <b style={{ fontFamily:T.mono }}>{c.efCover.toFixed(1)}</b> شهراً من احتياجاتك.
                  </div>
                </Card>
                <Card>
                  <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:6 }}>متى أصل للهدف؟</div>
                  <p style={{ fontSize:12.5, color:T.muted, marginTop:0, lineHeight:1.7 }}>
                    المدة حسب نسبة الادخار من الدخل. الصف المميّز هو أقرب نسبة لفائضك الفعلي.
                  </p>
                  {c.income === 0 ? <div style={{ fontSize:13, color:T.muted }}>أدخل دخلك في صفحة الميزانية أولاً.</div> :
                    [0.05,0.1,0.15,0.2,0.25,0.3,0.4,0.5].map((r) => {
                      const m = c.efGap > 0 ? c.efGap / (c.income * r) : 0;
                      const cur = Math.abs(r - c.savingsRate) < 0.03;
                      return (
                        <div key={r} style={{ display:"flex", justifyContent:"space-between", padding:"9px 10px", borderRadius:8, marginBottom:3, background:cur ? T.fill : "transparent", border:cur ? `1px solid ${T.fillLine}` : "1px solid transparent" }}>
                          <span style={{ fontFamily:T.mono, fontSize:13 }}>{(r * 100).toFixed(0)}%</span>
                          <span style={{ fontSize:13, color:T.ink2 }}>
                            {c.efGap === 0 ? "تم تحقيق الهدف ✓" : m < 12 ? `${Math.ceil(m)} شهراً` : `${(m / 12).toFixed(1)} سنة`}
                          </span>
                        </div>
                      );
                    })}
                </Card>
              </div>
            )}
          </>
        )}

        {view === "summary" && (
          <>
            <Head eyebrow="07 / READOUT" title="قراءة الخطة"
              sub="محاكاة شهرية على ستين شهراً: الفائض يذهب أولاً لإغلاق فجوة الطوارئ، وما يتبقى فقط هو ما يموّل الأهداف." />
            <Card style={{ marginBottom:16, background:c.firstShort !== null ? "#FBECEE" : "#F7FAF8" }}>
              <Row k="اكتمال صندوق الطوارئ" bold
                v={c.efGap === 0 ? "مكتمل" : c.efDone !== null ? when(c.efDone) : "لا يكتمل خلال الخطة"}
                col={c.efGap === 0 || c.efDone !== null ? T.good : T.bad} />
              <Row k="أول شهر يعجز عن التمويل" bold
                v={c.firstShort !== null ? when(c.firstShort) : "لا عجز"}
                col={c.firstShort !== null ? T.bad : T.good}
                hint={c.firstShort !== null
                  ? `أقصى عجز تراكمي ${money(c.worstShort, d.cur)}. ` + (c.byTierAll[2] > 0
                      ? `تأجيل أهداف الطموح (${money(c.byTierAll[2], d.cur)}) هو المدخل الأقل ضرراً.`
                      : "ولا توجد أهداف طموح تُؤجَّل — كل الأهداف أساسية أو مهمة، فالمخرج تأخير موعد أقربها أو رفع الفائض.")
                  : "الفائض يكفي لإغلاق الطوارئ ثم تمويل كل الأهداف في مواعيدها."} />
              <Row k="الرصيد المتبقي بعد خمس سنوات" v={money(c.endPot, d.cur)} col={c.endPot >= 0 ? T.good : T.bad} />
            </Card>
            <Card style={{ marginBottom:16 }}>
              <Suspense fallback={
                <div style={{ height:260, display:"flex", alignItems:"center", justifyContent:"center", color:T.muted, fontSize:13 }}>
                  جارٍ تحميل الرسم…
                </div>
              }>
                <CashflowChart
                  theme={T}
                  formatter={(v) => money(v, d.cur)}
                  data={[0,1,2,3,4].map((y) => ({
                    name:`Year ${y + 1}`,
                    "تكلفة الأهداف (اسمية)":c.costYear[y],
                    "المتاح فعلياً":Math.max(c.capYear[y], 0),
                  }))}
                />
              </Suspense>
              <p style={{ fontSize:11.5, color:T.muted, margin:"8px 0 0", lineHeight:1.7 }}>
                «المتاح فعلياً» هو الفائض السنوي بعد خصم ما ذهب لصندوق الطوارئ في تلك السنة، لا الفائض الخام.
                «تكلفة الأهداف» هنا اسمية — مضخّمة بمعدّل التضخّم ({d.inflation || 0}٪ سنوياً) حسب موعد كل هدف،
                لا بأسعار اليوم. بأسعار اليوم فقط: {money(c.goalsAllReal, d.cur)} مقابل {money(c.goalsAllNominal, d.cur)} اسمياً.
              </p>
            </Card>
            <div className="grid gap-4" style={{ gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))" }}>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:10 }}>الاستقلال المالي</div>
                <Row k="المبلغ المطلوب" v={c.annualExp ? money(c.fiTarget, d.cur) : "—"}
                  hint="خمسة وعشرون ضعف مصروفك السنوي، وفق قاعدة السحب 4٪ من دراسة ترينيتي." />
                <Row k="سنوات الوصول" v={c.fiYears ? `${c.fiYears} سنة` : c.surplus > 0 ? "أكثر من 60 سنة" : "لا فائض حالياً"}
                  col={c.fiYears && c.fiYears <= 25 ? T.good : T.ink} />
                {c.fiYears && c.fiPlus && c.fiPlus < c.fiYears && (
                  <Row k="لو ادّخرت 5٪ إضافية" v={`${c.fiPlus} سنة`} col={T.good}
                    hint={`أي ${money(c.income * 0.05, d.cur)} شهرياً تقصّر المدة ${c.fiYears - c.fiPlus} سنة.`} />
                )}
              </Card>
              <Card>
                <div style={{ fontFamily:T.display, fontWeight:700, marginBottom:10 }}>النمط والتخصيص</div>
                <Row k="النمط المالي" v={id.prof ? id.prof.name : "أكمل البطاقات"} />
                <Row k="نطاق الأصول النامية" v={c.equity || "أكمل F4 والبطاقات"}
                  hint="ناتج تقاطع أفقك مع ميل قراراتك بين النمو والأمان في البطاقات، لا مع تصريحك عن تحمّلك للمخاطرة." />
                {id.ready && id.P.safe >= 40 && (d.horizon === "l" || d.horizon === "xl") && (
                  <p style={{ fontSize:11.5, color:"#9A7A18", lineHeight:1.85, margin:"8px 0 0" }}>
                    {id.P.safe}٪ من قراراتك أمان مع أفق طويل. الحماية من التذبذب لا تحمي من التضخّم، وهذه كلفة صامتة تظهر بعد عشر سنوات لا بعد سنة.
                  </p>
                )}
              </Card>
            </div>
          </>
        )}

        {view === "report" && (
          <>
            <div className="no-print">
              <Head eyebrow="08 / REPORT" title="تقرير الجلسة"
                sub="صفحة واحدة يقرأها الكوتش قبل الجلسة: النمط، الوقائع، المؤشرات، التنبيهات، ثم الخطوات." />
              <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
                <button onClick={doPrint} style={{ ...btn, background:T.ink, color:"#fff", borderColor:T.ink, padding:"9px 16px" }}>طباعة</button>
                <button onClick={exportHtml} style={{ ...btn, padding:"9px 16px" }}>تنزيل التقرير</button>
                <span style={{ fontSize:11.5, color:T.muted, alignSelf:"center" }}>
                  لو حُجبت الطباعة داخل الإطار، نزّل التقرير وافتحه في المتصفح ثم احفظه PDF.
                </span>
              </div>
            </div>

            <Card className="rep-card" style={{ padding:26 }}>
              <div style={{ borderBottom:`2px solid ${T.ink}`, paddingBottom:12, marginBottom:18 }}>
                <div style={{ fontFamily:T.display, fontSize:19, fontWeight:700 }}>تقرير الخطة المالية</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>
                  تاريخ الإصدار {new Date().toLocaleDateString("en-GB")} · العملة {curOf(d.cur).label} · البطاقات {id.done}/{id.total} · الوقائع {factsDone}/6
                </div>
              </div>

              {id.prof && (
                <div style={{ background:T.ink, color:"#EAF2EE", padding:16, borderRadius:10, marginBottom:18 }}>
                  <b style={{ fontFamily:T.display, fontSize:15 }}>{id.prof.name} — {id.prof.sub}</b>
                  <div style={{ fontSize:12.5, marginTop:7, lineHeight:1.85, color:"#DCE9E4" }}>{id.prof.d}</div>
                  <div style={{ fontSize:12, marginTop:10, lineHeight:1.9, color:"#B9D2C9" }}>
                    <b style={{ color:"#7FD9BC" }}>قوّته:</b> {id.prof.good}<br />
                    <b style={{ color:"#F3A0AC" }}>فخّه:</b> {id.prof.trap}<br />
                    <b>الجملة التي يقولها:</b> «{id.prof.say}»
                  </div>
                </div>
              )}

              <RepSec title="الوقائع">{rep.profile.map(([k, v]) => <Row key={k} k={k} v={v} />)}</RepSec>
              <RepSec title="المؤشرات">{rep.diag.map(([k, v]) => <Row key={k} k={k} v={v} />)}</RepSec>

              <RepSec title={`التنبيهات (${rep.flags.length})`}>
                {rep.flags.length === 0
                  ? <p style={{ fontSize:13, color:T.muted, margin:0 }}>لا تنبيهات — كل المؤشرات ضمن النطاقات المرجعية.</p>
                  : rep.flags.map((f, i) => (
                    <div key={i} style={{
                      padding:"11px 13px", borderRadius:9, marginBottom:8, fontSize:13,
                      background:f.lvl === "high" ? "#FBECEE" : f.lvl === "med" ? T.fill : "#F1F5F3",
                      borderInlineStart:`3px solid ${f.lvl === "high" ? T.bad : f.lvl === "med" ? T.fillLine : "#9FB2AC"}`,
                    }}>
                      <b>{f.t}</b>
                      <span style={{ color:T.muted, fontSize:11.5 }}> — خطورة {f.lvl === "high" ? "مرتفعة" : f.lvl === "med" ? "متوسطة" : "منخفضة"}</span>
                      <div style={{ color:T.ink2, fontSize:12, marginTop:3, lineHeight:1.7 }}>{f.det}</div>
                    </div>
                  ))}
              </RepSec>

              <RepSec title="الخطوات التالية">
                {rep.actions.length === 0
                  ? <p style={{ fontSize:13, color:T.muted, margin:0 }}>تُحدَّد بعد إدخال الميزانية.</p>
                  : <ol style={{ paddingInlineStart:18, margin:0, fontSize:13, lineHeight:1.9 }}>
                      {rep.actions.map((a, i) => <li key={i} style={{ marginBottom:6 }}>{a}</li>)}
                    </ol>}
              </RepSec>

              <RepSec title={`الأهداف المسجّلة (${rep.goals.length})`}>
                {rep.goals.length === 0
                  ? <p style={{ fontSize:13, color:T.muted, margin:0 }}>لا أهداف مسجّلة بعد.</p>
                  : <div style={{ overflowX:"auto" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                        <thead>
                          <tr>{["الشهر","الهدف","التصنيف","التكلفة","التمويل"].map((h) => (
                            <th key={h} style={{ textAlign:"right", padding:"7px 8px", borderBottom:`1px solid ${T.line}`, color:T.muted, fontWeight:500, whiteSpace:"nowrap" }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {rep.goals.map((g, i) => (
                            <tr key={i}>{g.map((x, j) => (
                              <td key={j} style={{ padding:"7px 8px", borderBottom:`1px solid ${T.line}`, whiteSpace:j === 3 ? "nowrap" : "normal", fontFamily:j === 3 ? T.mono : T.body, direction:j === 3 ? "ltr" : "rtl" }}>{x}</td>
                            ))}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>}
              </RepSec>

              <p style={{ fontSize:11, color:T.muted, lineHeight:1.8, marginTop:22, borderTop:`1px solid ${T.line}`, paddingTop:10 }}>
                بطاقات القرار أداة تصنيفية استرشادية مستلهمة من نصوص المال (كلونتز)، والمحاسبة الذهنية (ثالر)،
                والخصم المفرط (لايبسون)، ومقياس اتجاهات المال (يامَوتشي وتمبلر). ليست أداة تشخيص نفسي معتمدة
                ولم تُقنَّن على عيّنة خليجية. بقية القواعد استرشادية وليست توصية استثمارية أو قانونية.
              </p>
            </Card>
          </>
        )}

        {view !== "report" && (
          <button className="no-print" onClick={nextView} style={{
            ...btn, width:"100%", marginTop:20, padding:"13px", fontSize:13.5,
            background:T.ink, color:"#fff", borderColor:T.ink,
          }}>
            التالي — {(NAV[NAV.findIndex(([k]) => k === view) + 1] || ["",""])[1]}
          </button>
        )}

        <div className="no-print" style={{ marginTop:24, paddingTop:16, borderTop:`1px solid ${T.line}`, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:T.muted }}>الحالة: {status}</span>
          <button onClick={exportJson} style={btn}>تصدير نسخة</button>
          {confirming ? (
            <>
              <button onClick={reset} style={{ ...btn, color:"#fff", background:T.bad, borderColor:T.bad }}>نعم، امسح كل شيء</button>
              <button onClick={() => setConfirming(false)} style={btn}>تراجع</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} style={{ ...btn, color:T.bad, borderColor:"#E9C8CE" }}>بدء خطة جديدة</button>
          )}
        </div>
      </main>
    </div>
  );
}
