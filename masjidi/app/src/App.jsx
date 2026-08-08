import { useEffect, useState } from 'react';
import * as api from './api';
import {
  AdminHome, AroundMe, Auth, ClaimMosque, ImamHome, MyVolunteering,
  Opportunities, Profile,
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
    ['mine', 'مهامّي', MyVolunteering],
    ['me', 'حسابي', Profile],
  ],
  admin: [
    ['home', 'الإدارة', AdminHome],
    ['me', 'حسابي', Profile],
  ],
  donor: [['near', 'حولي', AroundMe], ['me', 'حسابي', Profile]],
  contractor: [['me', 'حسابي', Profile]],
};

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
  const online = useOnline();

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
        <Screen onLogOut={signOut} />
      </main>

      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            aria-current={active[0] === key ? 'page' : undefined}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
