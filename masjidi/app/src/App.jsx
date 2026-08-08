import { useEffect, useState } from 'react';
import * as api from './api';
import {
  AdminHome, AroundMe, Auth, ClaimMosque, ImamHome, MyTasks,
  Notifications, Opportunities, Profile,
} from './screens.jsx';

/** التبويبات تختلف بالدور: لا معنى لعرض «تسجيل مسجد» لمتطوّع. */
const TABS = {
  imam: [
    ['home', 'مساجدي', ImamHome],
    ['near', 'حولي', AroundMe],
    ['claim', 'تسجيل مسجد', ClaimMosque],
    ['me', 'حسابي', Profile],
  ],
  volunteer: [
    ['home', 'الفرص', Opportunities],
    ['near', 'حولي', AroundMe],
    ['mine', 'مهامّي', MyTasks],
    ['me', 'حسابي', Profile],
  ],
  admin: [
    ['home', 'الإدارة', AdminHome],
    ['me', 'حسابي', Profile],
  ],
  donor: [['near', 'حولي', AroundMe], ['me', 'حسابي', Profile]],
  // الشركة تُكلَّف وتُنفّذ كالمتطوّع؛ ما ينقصها الاهتمام وحده — الإمام يختارها
  contractor: [['mine', 'مهامّي', MyTasks], ['me', 'حسابي', Profile]],
};

/**
 * التنبيهات لكل دور، وقبل «حسابي» مباشرةً.
 *
 * تُضاف هنا لا في كل صفّ أعلاه: نسيانُها لدورٍ واحد يعني أن صاحبه لا يرى ما
 * أُرسل إليه أصلاً — والدفع لا يصله أيضاً ما لم يُسجَّل Installation.
 */
for (const tabs of Object.values(TABS)) {
  tabs.splice(tabs.length - 1, 0, ['alerts', 'التنبيهات', Notifications]);
}

/** عدّاد غير المقروء للشارة. يُجلب بحدّ واحد: العدد وحده هو المطلوب. */
function useUnread(tab) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (tab === null) { setUnread(0); return undefined; } // لا جلب قبل الدخول
    let cancelled = false;
    api.getMyNotifications(1)
      .then((result) => { if (!cancelled) setUnread(result.unread); })
      .catch(() => {}); // الشارة زينة — فشلها لا يُعطّل شاشة
    return () => { cancelled = true; };
  }, [tab]);

  return unread;
}

/**
 * الاتصال.
 *
 * التطبيق يُثبَّت ويُفتح بلا إنترنت، لكن كل بياناته من الخادم — فالصادق أن
 * يُقال ذلك صراحةً بدل شاشات فارغة أو رسائل خطأ غامضة.
 */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

export default function App() {
  const [user, setUser] = useState(api.currentUser());
  const [tab, setTab] = useState('home');
  // ضغطة التبويب تُعيد التحميل ولو كان نشطاً أصلاً: الشاشات تجلب بياناتها عند
  // الظهور مرّة واحدة، فمن فتح التطبيق قبل نشر طلبٍ يبقى يرى قائمةً فارغة بلا
  // أي وسيلة لتحديثها. `key` متغيّر يُعيد تركيب الشاشة فتجلب من جديد.
  const [visit, setVisit] = useState(0);
  const online = useOnline();
  const unread = useUnread(user ? tab : null);

  if (!user) {
    return (
      <>
        {!online && (
          <div className="offline" role="status" data-testid="offline">
            لا يوجد اتصال — يلزم الاتصال لتسجيل الدخول.
          </div>
        )}
        <Auth onDone={() => { setUser(api.currentUser()); setTab('home'); }} />
      </>
    );
  }

  const role = user.get('role') || 'donor';
  const tabs = TABS[role] || TABS.donor;
  const active = tabs.find(([key]) => key === tab) || tabs[0];
  const Screen = active[2];

  async function signOut() {
    await api.logOut();
    setUser(null);
  }

  return (
    <div className="shell">
      <header className="top">
        <h1>مسجدي</h1>
        <span className="who">{user.get('fullName') || user.get('username')} · {api.ROLES[role]}</span>
      </header>

      {!online && (
        <div className="offline" role="status" data-testid="offline">
          لا يوجد اتصال — التطبيق مفتوح، لكن البيانات لا تُحدَّث حتى يعود الاتصال.
        </div>
      )}

      <main>
        <Screen key={`${active[0]}-${visit}`} onLogOut={signOut} />
      </main>

      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key); setVisit((n) => n + 1); }}
            aria-current={active[0] === key ? 'page' : undefined}>
            {label}
            {key === 'alerts' && unread > 0 && (
              <span className="badge" aria-label={`${unread} غير مقروء`}>{unread}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
