/**
 * مدخلُ نسخة العرض.
 *
 * **الشاشات هي الشاشات** — `App` و`screens.jsx` و`api.js` تُستورد كما هي بلا
 * حرفٍ واحد يُبدَّل. ما يُبدَّل شيئان لا ثالث لهما:
 *
 *   1. ناقلُ طلبات Parse → خادمٌ في الذاكرة (`server.js`).
 *   2. الموقع → نقطةُ المسجد المُهيَّأ، لأن الإطار المعزول يمنع تحديد الموقع
 *      فتُقرأ شاشتا «حولي» و«الفرص» على حالِ من رفض الإذن، وهي ليست الحال
 *      الغالبة.
 *
 * ولوحةُ الحسابات تُرسم **خارج `#root`** فلا تلمس شجرة التطبيق.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import App from '../src/App.jsx';
import { installDemoServer, DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_POINT } from './server.js';

installDemoServer();

/* موقعٌ ثابتٌ بدل تحديد الموقع — الإطار المعزول لا يأذن به */
const position = {
  coords: {
    latitude: DEMO_POINT.latitude, longitude: DEMO_POINT.longitude,
    accuracy: 18, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
  },
  timestamp: Date.now(),
};
Object.defineProperty(navigator, 'geolocation', {
  configurable: true,
  value: {
    getCurrentPosition: (ok) => setTimeout(() => ok(position), 150),
    watchPosition: (ok) => { setTimeout(() => ok(position), 150); return 1; },
    clearWatch: () => {},
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* ————— لوحةُ الحسابات ————— */

const panel = document.createElement('div');
panel.className = 'demo-panel';
panel.innerHTML = `
  <button class="demo-toggle" type="button" aria-expanded="false">
    <span>حسابات التجربة</span><span class="demo-caret">▾</span>
  </button>
  <div class="demo-body" hidden>
    <p class="demo-note">
      نسخةُ عرض: الخادم يعمل <b>داخل هذه الصفحة</b> لا على الشبكة، والبيانات
      تعود إلى حالها عند إعادة التحميل. والمساجد حقيقية — ٤٩٥ مسجداً من
      البيانات المفتوحة لوزارة الأوقاف.
    </p>
    <p class="demo-note">
      وادخل بحسابٍ منها، ثم <b>بدّله من «حسابي ← خروج»</b> لترى أثر ما فعلتَه
      بعينِ الطرف الآخر: سجّل اهتمامك متطوّعاً، ثم ادخل قائماً على المسجد فتجده
      في المهتمّين.
    </p>
    <ul>
      ${DEMO_ACCOUNTS.map((account) => `
        <li>
          <button type="button" data-user="${account.username}">
            <b>${account.label}</b>
            <span>${account.note}</span>
          </button>
        </li>`).join('')}
    </ul>
    <p class="demo-note demo-creds">
      وكلمةُ المرور واحدة: <code>${DEMO_PASSWORD}</code>
    </p>
  </div>`;
document.body.appendChild(panel);

const toggle = panel.querySelector('.demo-toggle');
const body = panel.querySelector('.demo-body');
toggle.addEventListener('click', () => {
  const open = body.hidden;
  body.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  panel.classList.toggle('open', open);
});

/** يملأ نموذج الدخول ويضغطه — التجربة لا تبدأ بكتابة كلمة مرور. */
panel.addEventListener('click', (event) => {
  const button = event.target.closest('[data-user]');
  if (!button) return;

  const form = document.querySelector('.auth form');
  if (!form) return;
  const [username, password] = form.querySelectorAll('input');
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue(username, button.dataset.user);
  setValue(password, DEMO_PASSWORD);
  form.requestSubmit();
  body.hidden = true;
  panel.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
});
