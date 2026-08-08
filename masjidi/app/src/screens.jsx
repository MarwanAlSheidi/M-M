import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { MAPS_KEY, VIEWS, loadGoogleMaps } from './maps';

/* ————— لبنات مشتركة ————— */

let fieldSeq = 0;

/**
 * حقل معنون. الربط بـ`htmlFor`/`id` لا زينة: بدونه لا يجد قارئُ الشاشة العنوان،
 * ولا يصل النقر على العنوان إلى الحقل.
 */
export function Field({ label, options, multiline, ...props }) {
  const [id] = useState(() => `field-${++fieldSeq}`);

  return (
    <>
      <label htmlFor={id}>{label}</label>
      {options
        ? (
          <select id={id} {...props}>
            {Object.entries(options).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        )
        : multiline
          ? <textarea id={id} {...props} />
          : <input id={id} {...props} />}
    </>
  );
}

/**
 * أين المسجد — لا اسمه.
 *
 * أسماء المساجد تتكرّر بالمئات على مستوى السلطنة («مصلى العيدين» اسمٌ لـ369
 * مسجداً)، فالاسم وحده لا يدلّ على شيء. القرية أدقّ ما يميّز، ثم الولاية.
 */
export const Where = ({ wilayat, village, governorate, mosqueNumber }) => {
  const parts = [wilayat, village || governorate].filter(Boolean);
  if (!parts.length && !mosqueNumber) return null;

  return (
    <>
      {parts.length > 0 && <p>{parts.join(' — ')}</p>}
      {/* 417 مجموعة تتطابق في الاسم والولاية والقرية معاً — 1,084 مسجداً —
          ولا يميّزها إلا رقم الوزارة، وهو ما بيد الإمام في أوراق مسجده */}
      {mosqueNumber && <p className="when">رقم الوزارة: {mosqueNumber}</p>}
    </>
  );
};

/** اختيار المهارات من فئات الأعمال نفسها — لا نصّاً حرّاً يتشتّت. */
export function SkillPicker({ value, onChange }) {
  const toggle = (key) => onChange(
    value.includes(key) ? value.filter((s) => s !== key) : [...value, key],
  );

  return (
    <div className="row">
      {Object.entries(api.CATEGORIES).map(([key, label]) => (
        <button type="button" key={key}
          className={value.includes(key) ? '' : 'ghost'}
          aria-pressed={value.includes(key)}
          onClick={() => toggle(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const StatusTag = ({ status }) => {
  const tone = status === 'completed' ? 'done'
    : status === 'cancelled' ? 'off'
      : status === 'open_for_volunteers' ? '' : 'warn';
  return <span className={`tag ${tone}`}>{api.STATUS_LABEL[status] || status}</span>;
};

/** يستدعي `load` ويعرض الحالات الثلاث: تحميل، فراغ، بيانات. */
export function useList(load, deps = []) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      setState({ loading: false, rows: await load(), error: '' });
    } catch (error) {
      setState({ loading: false, rows: [], error: api.messageOf(error) });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, refresh };
}

export function Listing({ state, empty, children }) {
  if (state.loading) return <p className="empty">جارٍ التحميل…</p>;
  if (state.error) return <div className="error">{state.error}</div>;
  if (state.rows.length === 0) return <p className="empty">{empty}</p>;
  return children;
}

/* ————— الدخول ————— */

export function Auth({ onDone }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    username: '', password: '', fullName: '', phone: '', role: 'volunteer',
    companyName: '', crNumber: '', governorate: '',
  });
  const [skills, setSkills] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await api.logIn(form.username, form.password);
      else await api.signUp({ ...form, skills });
      onDone();
    } catch (caught) {
      setError(api.messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <h1>مسجدي</h1>
      <p className="sub">صيانة بيوت الله بأيدي أهل الحيّ</p>

      <form onSubmit={submit}>
        <Field label="اسم المستخدم" value={form.username} onChange={set('username')}
          autoComplete="username" required />
        <Field label="كلمة المرور" type="password" value={form.password}
          onChange={set('password')} autoComplete="current-password" required />

        {mode === 'signup' && (
          <>
            <Field label="الاسم الكامل" value={form.fullName} onChange={set('fullName')} />
            <Field label="رقم الهاتف" value={form.phone} onChange={set('phone')} inputMode="tel" />
            <Field label="الصفة" value={form.role} onChange={set('role')} options={api.ROLES} />

            <Field label="المحافظة" value={form.governorate} onChange={set('governorate')}
              options={{ '': '— اختر —', ...Object.fromEntries(api.GOVERNORATES.map((g) => [g, g])) }} />

            {form.role === 'volunteer' && (
              <>
                <label>مهاراتك</label>
                <SkillPicker value={skills} onChange={setSkills} />
                <p className="hint">
                  الإمام يرى مهاراتك عند اختيار المنفّذ — واتركها فارغة إن شئت.
                </p>
              </>
            )}

            {form.role === 'contractor' && (
              <>
                <Field label="اسم الشركة" value={form.companyName}
                  onChange={set('companyName')} />
                <Field label="رقم السجل التجاري" value={form.crNumber}
                  onChange={set('crNumber')} inputMode="numeric" />
                <p className="hint">
                  تُراجع الإدارة السجل التجاري قبل أن تُسنَد إليكم أعمال.
                </p>
              </>
            )}

            {form.role === 'donor' && (
              <p className="hint">
                التبرّع النقدي غير مُفعَّل بعد — يتطلّب تصريحاً من وزارة الأوقاف.
                يمكنك تصفّح المساجد القريبة، وإن أردت المشاركة الآن فاختر
                «متطوّع».
              </p>
            )}
          </>
        )}

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 14 }}>
          {busy ? 'لحظة…' : mode === 'login' ? 'دخول' : 'إنشاء حساب'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 12 }}>
        <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
          {mode === 'login' ? 'ليس لديك حساب؟ سجّل الآن' : 'لديك حساب؟ ادخل'}
        </button>
      </p>
    </div>
  );
}


/* ————— الموقع ————— */

/**
 * موقع الجهاز مرة واحدة، ويُرسَل إلى الخادم ليصل المتطوّعَ إشعارُ الفرص القريبة.
 * إرسال الموقع أثر جانبي، ففشله لا يمنع عرض ما حولك.
 */
export function useLocation() {
  const [state, setState] = useState({ loading: true, point: null, error: '' });

  const locate = useCallback(async () => {
    setState({ loading: true, point: null, error: '' });
    try {
      const point = await api.currentPosition();
      setState({ loading: false, point, error: '' });
      api.updateMyLocation(point.lat, point.lng).catch(() => {});
    } catch (error) {
      setState({ loading: false, point: null, error: api.messageOf(error) });
    }
  }, []);

  useEffect(() => { locate(); }, [locate]);
  return { ...state, locate };
}

function LocationGate({ location, children }) {
  if (location.loading) return <p className="empty">جارٍ تحديد موقعك…</p>;
  if (location.error) {
    return (
      <>
        <div className="error">{location.error}</div>
        <button className="ghost" onClick={location.locate}>حاول مرة أخرى</button>
      </>
    );
  }
  return children;
}


/**
 * خريطة المساجد حول المستخدم.
 *
 * العلامة الزرقاء موقعه، والخُضر المساجد؛ والنقر على مسجد يفتح بطاقته مع زرّ
 * اختياره. الحدود تُضبط لتشمل الجميع بدل تخمين مستوى التقريب.
 */
function MosqueMap({ center, mosques, onPick }) {
  const holder = useRef(null);
  const map = useRef(null);
  const markers = useRef([]);
  const info = useRef(null);
  const [view, setView] = useState('roadmap');
  const [error, setError] = useState('');

  // إنشاء الخريطة مرة واحدة
  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !holder.current) return;
        map.current = new maps.Map(holder.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom: 14,
          mapTypeId: view,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        info.current = new maps.InfoWindow();

        new maps.Marker({
          map: map.current,
          position: { lat: center.lat, lng: center.lng },
          title: 'موقعك',
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#1a73e8',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
        });
      })
      .catch((caught) => { if (!cancelled) setError(caught.message); });

    return () => { cancelled = true; };
  }, [center.lat, center.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // إعادة رسم العلامات كلما تغيّرت القائمة (تغيّر النطاق مثلاً)
  useEffect(() => {
    const maps = window.google && window.google.maps;
    if (!maps || !map.current) return;

    markers.current.forEach((marker) => marker.setMap(null));
    markers.current = [];

    const bounds = new maps.LatLngBounds();
    bounds.extend({ lat: center.lat, lng: center.lng });

    mosques.filter((mosque) => mosque.lat != null).forEach((mosque) => {
      const position = { lat: mosque.lat, lng: mosque.lng };
      const marker = new maps.Marker({ map: map.current, position, title: mosque.name });

      marker.addListener('click', () => {
        info.current.setContent(
          `<div dir="rtl" style="font-family:inherit;min-width:150px">
             <strong>${mosque.name}</strong><br/>
             ${mosque.wilayat || ''} · ${api.formatDistance(mosque.distanceKm)}
           </div>`,
        );
        info.current.open({ map: map.current, anchor: marker });
        onPick(mosque);
      });

      markers.current.push(marker);
      bounds.extend(position);
    });

    if (markers.current.length > 0) map.current.fitBounds(bounds, 48);
  }, [mosques, center.lat, center.lng, onPick]);

  function switchView(next) {
    setView(next);
    if (map.current) map.current.setMapTypeId(next);
  }

  if (error) {
    return (
      <div className="notice" data-testid="map-error">
        {error} — القائمة أدناه تعمل بلا خريطة.
      </div>
    );
  }

  return (
    <div className="mapwrap">
      <div className="row mapviews">
        {Object.entries(VIEWS).map(([key, label]) => (
          <button key={key} className={view === key ? '' : 'ghost'}
            onClick={() => switchView(key)}>{label}</button>
        ))}
      </div>
      <div className="map" ref={holder} data-testid="map" />
    </div>
  );
}

const DistanceTag = ({ km }) => <span className="tag dist">{api.formatDistance(km)}</span>;

/** المساجد حول المستخدم — «موقع المسجد هو ما يربط المصلّي بمسجده». */
/**
 * سجلّ المسجد — ما جرى فيه من صيانة.
 *
 * مفتوحٌ لكل مستخدم مصادَق قصداً: المصلّي له أن يعرف ما جرى لمسجده، وهذه هي
 * الشفافية التي قامت عليها المنصّة. والفاعل يُذكر بصفته لا باسمه.
 */
export function MosqueTrail({ mosqueId, mosqueName }) {
  const state = useList(() => api.getMosqueAuditTrail(mosqueId), [mosqueId]);

  return (
    <>
      <h2>سجلّ {mosqueName || 'المسجد'}</h2>
      <Listing state={state} empty="لا حركة مسجّلة على هذا المسجد بعد.">
        <div>
          {state.rows.map((entry, at) => (
            <article className="card" key={`${entry.createdAt}-${at}`}>
              <p style={{ margin: 0 }}>
                {api.AUDIT_LABEL[entry.action] || entry.action}
              </p>
              <p className="when">
                {new Date(entry.createdAt).toLocaleString('ar')}
                {entry.actorRole ? ` · ${api.ACTOR_LABEL[entry.actorRole] || entry.actorRole}` : ''}
              </p>
            </article>
          ))}
        </div>
      </Listing>
    </>
  );
}

export function AroundMe() {
  const location = useLocation();
  const [radius, setRadius] = useState(5);
  const [message, setMessage] = useState('');

  const state = useList(
    async () => (location.point
      ? api.nearbyMosques(location.point.lat, location.point.lng, radius) : []),
    [location.point && location.point.lat, location.point && location.point.lng, radius],
  );

  async function pick(mosque) {
    setMessage('');
    try {
      const result = await api.setFavoriteMosque(mosque.objectId);
      setMessage(`${result.mosqueName} صار مسجدك.`);
    } catch (error) {
      setMessage(api.messageOf(error));
    }
  }

  const [selected, setSelected] = useState(null);
  const [trail, setTrail] = useState(null);
  const [showMap, setShowMap] = useState(Boolean(MAPS_KEY));

  // الشفافية لا تُشترط دوراً: من صلّى في المسجد له أن يعرف ما جرى فيه
  if (trail) {
    return (
      <>
        <button className="link" onClick={() => setTrail(null)}>→ رجوع</button>
        <MosqueTrail mosqueId={trail.objectId} mosqueName={trail.name} />
      </>
    );
  }

  return (
    <>
      <div className="spread">
        <h2 style={{ margin: 0 }}>حولي</h2>
        {MAPS_KEY && (
          <button className="link" onClick={() => setShowMap(!showMap)}>
            {showMap ? 'عرض كقائمة' : 'عرض على الخريطة'}
          </button>
        )}
      </div>
      <LocationGate location={location}>
        <>
          {showMap && location.point && (
            <MosqueMap center={location.point} mosques={state.rows} onPick={setSelected} />
          )}
          {selected && (
            <article className="card" data-testid="picked">
              <div className="spread">
                <h3>{selected.name}</h3>
                <DistanceTag km={selected.distanceKm} />
              </div>
              <p>{selected.wilayat} — {selected.village || selected.governorate}</p>
              <div className="row">
                <button onClick={() => pick(selected)}>هذا مسجدي</button>
                <a className="maplink" href={api.mapsLink(selected.lat, selected.lng, selected.name)}
                  target="_blank" rel="noreferrer">الاتجاهات</a>
                <button className="ghost" onClick={() => setTrail(selected)}>سجلّ المسجد</button>
              </div>
            </article>
          )}

          <div className="row" style={{ marginBottom: 12 }}>
            {[1, 5, 15, 50].map((km) => (
              <button key={km} className={radius === km ? '' : 'ghost'}
                onClick={() => setRadius(km)}>
                {km} كم
              </button>
            ))}
          </div>
          {message && <div className="notice">{message}</div>}

          <Listing state={state} empty="لا مسجد ضمن هذا النطاق — وسّع الدائرة.">
            <div>
              {state.rows.map((mosque) => (
                <article className="card" key={mosque.objectId}>
                  <div className="spread">
                    <h3>{mosque.name}</h3>
                    <DistanceTag km={mosque.distanceKm} />
                  </div>
                  <p>{mosque.wilayat} — {mosque.village || mosque.governorate}</p>
                  <div className="row">
                    <button className="ghost" onClick={() => pick(mosque)}>هذا مسجدي</button>
                    <button className="link" onClick={() => setTrail(mosque)}>سجلّ المسجد</button>
                    {mosque.lat != null && (
                      <a className="maplink"
                        href={api.mapsLink(mosque.lat, mosque.lng, mosque.name)}
                        target="_blank" rel="noreferrer">الاتجاهات</a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </Listing>
        </>
      </LocationGate>
    </>
  );
}

/* ————— المتطوّع ————— */

export function Opportunities() {
  const location = useLocation();
  const [radius, setRadius] = useState(15);
  const [message, setMessage] = useState('');

  // المتطوّع يبحث عن عمل قريب منه، فالترتيب بالمسافة. وإن تعذّر الموقع تُعرض
  // الفرص كلها بالأحدث بدل شاشة فارغة.
  const nearby = Boolean(location.point);
  const state = useList(
    async () => (nearby
      ? api.nearbyOpportunities(location.point.lat, location.point.lng, radius)
      : api.openOpportunities()),
    [nearby, location.point && location.point.lat, radius],
  );

  async function join(requestId) {
    setMessage('');
    try {
      const result = await api.expressInterest(requestId);
      setMessage(result.message);
    } catch (error) {
      setMessage(api.messageOf(error));
    }
  }

  return (
    <>
      <h2>{nearby ? 'فرص قريبة منك' : 'فرص التطوّع المفتوحة'}</h2>

      {location.loading && <p className="empty">جارٍ تحديد موقعك…</p>}
      {location.error && (
        <div className="notice">
          {location.error} — تُعرض الفرص كلها بلا ترتيب بالمسافة.{' '}
          <button className="link" onClick={location.locate}>أعد المحاولة</button>
        </div>
      )}
      {nearby && (
        <div className="row" style={{ marginBottom: 12 }}>
          {[5, 15, 50].map((km) => (
            <button key={km} className={radius === km ? '' : 'ghost'}
              onClick={() => setRadius(km)}>ضمن {km} كم</button>
          ))}
        </div>
      )}

      {message && <div className="notice">{message}</div>}
      <Listing state={state} empty="لا توجد فرص مفتوحة الآن.">
        <div>
          {state.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.title}</h3>
                {/* المسافة مجهولة حين لا يكون للمسجد إحداثيات — يُقال صراحةً
                    بدل وسمٍ عامّ يُفهَم منه أن الفرصة قريبة */}
                {row.distanceKm != null
                  ? <DistanceTag km={row.distanceKm} />
                  : nearby
                    ? <span className="tag warn">موقعه غير مسجّل</span>
                    : <StatusTag status={row.status} />}
              </div>
              <p>{row.mosqueName}</p>
              <Where wilayat={row.wilayat} village={row.village} />
              <p>{row.description}</p>
              <div className="row">
                <span className="tag">{api.CATEGORIES[row.category] || 'أخرى'}</span>
                <button onClick={() => join(row.id)}>يهمّني</button>
              </div>
            </article>
          ))}
        </div>
      </Listing>
    </>
  );
}

/**
 * إبلاغ الإنجاز بصوره.
 *
 * الإمام يعتمد العمل، وبلا صورة يعتمده دون أن يراه — فالصور هي الدليل الذي
 * تقوم عليه دورة «المنفّذ يبلّغ والإمام يقفل». تُرفع أولاً ثم يُرسَل الإبلاغ،
 * فلا يُقفل الطلب على رفعٍ لم يكتمل.
 */
function ReportWork({ request, onDone }) {
  const [files, setFiles] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    try {
      const urls = [];
      for (const [index, file] of files.entries()) {
        setBusy(`جارٍ رفع الصورة ${index + 1} من ${files.length}…`);
        urls.push(await api.uploadPhoto(file));
      }
      setBusy('جارٍ الإبلاغ…');
      await api.markWorkDone(request.id, notes || 'أُنجز العمل.', urls);
      onDone();
    } catch (caught) {
      setError(api.messageOf(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="report">
      <Field label="ملاحظات (اختياري)" value={notes}
        onChange={(event) => setNotes(event.target.value)} />

      <label htmlFor={`photos-${request.id}`}>صور الإنجاز</label>
      <input id={`photos-${request.id}`} type="file" accept="image/*" multiple
        data-testid="photo-input"
        onChange={(event) => setFiles(Array.from(event.target.files).slice(0, 6))} />
      {files.length > 0 && (
        <p className="hint">{files.length} صورة مختارة — تُرفع عند الإبلاغ.</p>
      )}

      {error && <div className="error">{error}</div>}
      {busy && <p className="hint">{busy}</p>}

      <button onClick={submit} disabled={Boolean(busy)}>أنجزتُ العمل</button>
    </div>
  );
}

/**
 * أعمال المنفّذ — متطوّعاً كان أو شركة.
 *
 * الشركة تُكلَّف وتُنفّذ وتُبلّغ كالمتطوّع تماماً على الخادم، ويختلفان في
 * الاهتمام وحده: `expressInterest` للمتطوّعين، والشركة يختارها الإمام مباشرةً.
 */
export function MyTasks() {
  const isVolunteer = api.currentRole() === 'volunteer';
  const profile = useList(async () => [await api.getMyProfile()]);
  const pending = profile.rows[0] && profile.rows[0].isVerifiedContractor === false;
  // الاستدعاء لا يُشترط: `getMyInterests` مقصورة على المتطوّعين فتردّ الشركة
  const interests = useList(async () => (isVolunteer ? api.getMyInterests() : []));
  const tasks = useList(api.assignedToMe);
  const [error, setError] = useState('');

  async function act(action, ...args) {
    setError('');
    try {
      await action(...args);
      tasks.refresh();
      interests.refresh();
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  return (
    <>
      <h2>مهامّي</h2>
      {error && <div className="error">{error}</div>}

      {/* الشركة غير المعتمدة كانت ترى قائمة فارغة إلى الأبد بلا سبب معروف */}
      {!isVolunteer && pending && (
        <div className="notice">
          حسابكم بانتظار اعتماد الإدارة للسجل التجاري. لا تُسنَد إليكم أعمال
          قبل الاعتماد.
        </div>
      )}

      <Listing state={tasks} empty="لم يُسنَد إليك عمل بعد.">
        <div>
          {tasks.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.title}</h3>
                <StatusTag status={row.status} />
              </div>
              <p>{row.mosqueName}</p>
              <Where wilayat={row.wilayat} village={row.village} />
              {row.mosqueLat != null && (
                <p>
                  <a className="maplink" target="_blank" rel="noreferrer"
                    href={api.mapsLink(row.mosqueLat, row.mosqueLng, row.mosqueName)}>
                    الطريق إلى المسجد
                  </a>
                </p>
              )}
              {row.status === 'assigned' && (
                <div className="row">
                  <button onClick={() => act(api.startWork, row.id)}>بدأت العمل</button>
                  {/* الاعتذار قبل الموعد خيرٌ من التغيّب عنه، ولا يُقيَّد على المنفّذ */}
                  <button className="ghost" onClick={() => act(api.releaseAssignment, row.id)}>
                    أعتذر — أعيدوه لغيري
                  </button>
                </div>
              )}
              {row.status === 'in_progress' && (
                <ReportWork request={row} onDone={() => { tasks.refresh(); interests.refresh(); }} />
              )}
              {row.status === 'pending_imam_approval' && <p>بانتظار معاينة الإمام واعتماده.</p>}
            </article>
          ))}
        </div>
      </Listing>

      {isVolunteer && (
        <>
      <h2>اهتماماتي</h2>
      <Listing state={interests} empty="لم تسجّل اهتماماً بعد.">
        <div>
          {interests.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.requestTitle}</h3>
                <span className={`tag ${row.status === 'active' ? '' : 'off'}`}>
                  {row.status === 'active' ? 'بانتظار اختيار الإمام'
                    : row.status === 'withdrawn' ? 'مسحوب' : 'أُغلق'}
                </span>
              </div>
              {row.status === 'active' && (
                <button className="ghost" onClick={() => act(api.withdrawInterest, row.requestId)}>
                  سحب الاهتمام
                </button>
              )}
            </article>
          ))}
        </div>
      </Listing>
        </>
      )}
    </>
  );
}

/* ————— الإمام ————— */

export function ImamHome() {
  // المساجد من `Mosques.imamId` لا من الطلبات: هو ما يتحقّق منه الخادم
  const mosques = useList(api.getMyMosques);
  const [trail, setTrail] = useState(null);
  const claims = useList(api.getMyClaims);
  const [openMosque, setOpenMosque] = useState(null);

  if (openMosque) {
    return <MosqueRequests mosque={openMosque} onBack={() => setOpenMosque(null)} />;
  }

  if (trail) {
    return (
      <>
        <button className="link" onClick={() => setTrail(null)}>→ رجوع</button>
        <MosqueTrail mosqueId={trail.objectId} mosqueName={trail.name} />
      </>
    );
  }

  const waiting = claims.rows.filter((claim) => claim.status !== 'approved');

  return (
    <>
      <h2>مساجدي</h2>
      <Listing state={mosques} empty="لم تسجّل مسجداً بعد — ابحث عنه من تبويب «تسجيل مسجد».">
        <div>
          {mosques.rows.map((mosque) => (
            <article className="card" key={mosque.id}>
              <div className="spread">
                <h3>{mosque.name}</h3>
                {mosque.openRequestsCount > 0 && (
                  <span className="tag warn">{mosque.openRequestsCount} طلب مفتوح</span>
                )}
              </div>
              <Where wilayat={mosque.wilayat} village={mosque.village}
                governorate={mosque.governorate} mosqueNumber={mosque.mosqueNumber} />
              <div className="row">
                <button onClick={() => setOpenMosque({ mosqueId: mosque.id, mosqueName: mosque.name })}>
                  طلبات الصيانة
                </button>
                {/* الإمام يرى سجلّ مسجده كما يراه المصلّي — لا امتياز في الشفافية */}
                <button className="ghost"
                  onClick={() => setTrail({ objectId: mosque.id, name: mosque.name })}>
                  سجلّ المسجد
                </button>
              </div>
            </article>
          ))}
        </div>
      </Listing>

      {waiting.length > 0 && (
        <>
          <h2>طلبات ملكية قيد المراجعة</h2>
          {waiting.map((claim) => (
            <article className="card" key={claim.id}>
              <div className="spread">
                <h3>{claim.mosqueName}</h3>
                <span className={`tag ${claim.status === 'rejected' ? 'off' : 'warn'}`}>
                  {claim.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                </span>
              </div>
              <Where wilayat={claim.wilayat} village={claim.village}
                mosqueNumber={claim.mosqueNumber} />
              {claim.status === 'pending' && <p>سيراجع المشرف طلبك خلال أيام عمل.</p>}
            </article>
          ))}
        </>
      )}
    </>
  );
}

function MosqueRequests({ mosque, onBack }) {
  const state = useList(() => api.requestsForMosque(mosque.mosqueId), [mosque.mosqueId]);
  const [creating, setCreating] = useState(false);
  const [openRequest, setOpenRequest] = useState(null);

  if (openRequest) {
    return (
      <RequestDetail
        request={openRequest}
        onBack={() => { setOpenRequest(null); state.refresh(); }}
      />
    );
  }

  if (creating) {
    return (
      <NewRequest
        mosque={mosque}
        onBack={(created) => { setCreating(false); if (created) state.refresh(); }}
      />
    );
  }

  return (
    <>
      <button className="link" onClick={onBack}>→ رجوع إلى مساجدي</button>
      <div className="spread" style={{ marginTop: 10 }}>
        <h2 style={{ margin: 0 }}>{mosque.mosqueName}</h2>
        <button onClick={() => setCreating(true)}>طلب جديد</button>
      </div>

      <Listing state={state} empty="لا توجد طلبات لهذا المسجد.">
        <div style={{ marginTop: 12 }}>
          {state.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.title}</h3>
                <StatusTag status={row.status} />
              </div>
              <p>{api.CATEGORIES[row.category] || 'أخرى'}</p>
              <button className="ghost" onClick={() => setOpenRequest(row)}>التفاصيل</button>
            </article>
          ))}
        </div>
      </Listing>
    </>
  );
}

function NewRequest({ mosque, onBack }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'other' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createServiceRequest({ ...form, mosqueId: mosque.mosqueId });
      onBack(true);
    } catch (caught) {
      setError(api.messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <button className="link" onClick={() => onBack(false)}>→ رجوع</button>
      <h2>طلب صيانة جديد</h2>
      <p className="empty" style={{ textAlign: 'start', padding: 0 }}>
        الطلبات في هذه المرحلة تطوّعية عينية بلا تكلفة مالية.
      </p>

      <form onSubmit={submit}>
        <Field label="العنوان" value={form.title} onChange={set('title')} required />
        <Field label="الوصف" multiline value={form.description}
          onChange={set('description')} required />
        <Field label="النوع" value={form.category} onChange={set('category')}
          options={api.CATEGORIES} />

        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy} style={{ marginTop: 14 }}>
          {busy ? 'لحظة…' : 'نشر الطلب'}
        </button>
      </form>
    </>
  );
}

function RequestDetail({ request, onBack }) {
  const [status, setStatus] = useState(request.status);
  const interests = useList(
    () => (status === 'open_for_volunteers' ? api.getRequestInterests(request.id) : []),
    [request.id, status],
  );
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function act(action, ...args) {
    setError('');
    try {
      const result = await action(...args);
      setStatus(result.status || 'assigned');
      interests.refresh();
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  return (
    <>
      <button className="link" onClick={onBack}>→ رجوع</button>
      <div className="spread" style={{ marginTop: 10 }}>
        <h2 style={{ margin: 0 }}>{request.title}</h2>
        <StatusTag status={status} />
      </div>
      <p style={{ color: 'var(--muted)' }}>{request.description}</p>
      {error && <div className="error">{error}</div>}

      {status === 'open_for_volunteers' && (
        <>
          <h2>المتطوّعون المهتمّون</h2>
          <Listing state={interests} empty="لم يسجّل أحد اهتمامه بعد.">
            <div>
              {interests.rows.map((row) => (
                <article className="card" key={row.interestId}>
                  <div className="spread">
                    <h3>{row.fullName || 'متطوّع'}</h3>
                    {row.avgRating != null && <span className="tag">تقييم {row.avgRating}</span>}
                  </div>
                  {/* المهارات تُخزَّن بمفاتيح إنجليزية وتُقرأ بالعربية */}
                  <p>مهارات: {row.skills.length
                    ? row.skills.map((key) => api.CATEGORIES[key] || key).join('، ')
                    : 'غير محدّدة'}</p>
                  <p>أعمال منجزة: {row.completedJobs}</p>
                  {row.abandonedJobs > 0 && (
                    <p className="warn">تغيّب عن {row.abandonedJobs} تكليفاً سابقاً.</p>
                  )}
                  {row.note && <p>«{row.note}»</p>}
                  <button onClick={() => act(api.assignWorker, request.id, row.volunteerId)}>
                    كلّفه بالعمل
                  </button>
                </article>
              ))}
            </div>
          </Listing>
          <button className="danger" onClick={() => act(api.cancelServiceRequest, request.id)}>
            إلغاء الطلب
          </button>
        </>
      )}

      {status === 'assigned' && (
        <>
          <h2>بانتظار المنفّذ</h2>
          <p className="notice">
            كُلِّف المنفّذ ولمّا يبدأ بعد. إن لم يحضر فاسحب التكليف ليعود الطلب
            متاحاً لغيره — لا حاجة إلى إلغائه وإنشاء طلب جديد.
          </p>
          <button className="danger" onClick={() => act(api.releaseAssignment, request.id, 'no_show')}>
            سحب التكليف — لم يحضر
          </button>
        </>
      )}

      {status === 'pending_imam_approval' && (
        <>
          <h2>معاينة واعتماد</h2>
          {request.workerNotes && <p className="notice">«{request.workerNotes}»</p>}
          {request.completionPhotos.length > 0 ? (
            <div className="gallery" data-testid="gallery">
              {request.completionPhotos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="صورة الإنجاز" loading="lazy" />
                </a>
              ))}
            </div>
          ) : (
            <p className="hint">لم يرفع المنفّذ صوراً — عاين العمل على الطبيعة قبل الاعتماد.</p>
          )}
          <Field label="ساعات التطوّع (اختياري)" value={note}
            onChange={(event) => setNote(event.target.value)} inputMode="numeric" />
          <button onClick={() => act(api.completeService, request.id, 5, Number(note) || 0)}>
            اعتماد العمل
          </button>
        </>
      )}

      {['assigned', 'in_progress'].includes(status) && (
        <p className="notice">العمل جارٍ — يُبلّغك المنفّذ عند الإنجاز.</p>
      )}
    </>
  );
}

/**
 * تسجيل المسجد.
 *
 * أسماء المساجد تتكرّر كثيراً على مستوى السلطنة — «مصلى العيدين» اسمٌ لـ369
 * مسجداً — فالبحث بالاسم وحده يُرجع مئة نتيجة متطابقة الظاهر، ولا يعرف الإمام
 * أيّها مسجده. ولذلك ثلاثة أشياء هنا: تصفيةٌ بالمحافظة، وعرض القرية (أدقّ ما
 * يميّز)، وإرشادٌ إلى إضافة اسم القرية للبحث — والقرية ضمن كلمات البحث المفهرسة
 * فـ«العيدين المنجرد» يُرجع نتيجةً واحدة.
 */
const SEARCH_CAP = 100;

export function ClaimMosque() {
  // موقع الإمام يُرتّب النتائج بالأقرب — وهو ما يميّز متطابقي الاسم فعلاً.
  // فشلُ تحديد الموقع لا يمنع البحث: يسقط إلى الترتيب الطبيعي.
  const location = useLocation();
  const [term, setTerm] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function search(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      setRows(await api.searchMosques(term, governorate || undefined, location.point));
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  async function claim(mosque) {
    setError('');
    try {
      const result = await api.claimMosque(mosque.objectId, 'طلب من التطبيق');
      setMessage(result.message);
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  return (
    <>
      <h2>تسجيل مسجد</h2>
      <form onSubmit={search}>
        <div className="row">
          <input value={term} onChange={(event) => setTerm(event.target.value)}
            placeholder="ابحث باسم المسجد" aria-label="اسم المسجد" style={{ flex: 1 }} />
          <button type="submit">بحث</button>
        </div>
        <select value={governorate} aria-label="المحافظة"
          onChange={(event) => setGovernorate(event.target.value)} style={{ marginTop: 8 }}>
          <option value="">كل المحافظات</option>
          {api.GOVERNORATES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </form>
      <p className="hint">
        {location.point
          ? 'كثير من المساجد تتشابه أسماؤها — النتائج مرتّبة بالأقرب إليك، فمسجدك في صدرها غالباً.'
          : 'كثير من المساجد تتشابه أسماؤها — أضِف اسم القرية إلى البحث أو اختر محافظتك لتصل إلى مسجدك.'}
      </p>

      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {rows && rows.length === 0 && <p className="empty">لا نتائج.</p>}
      {rows && rows.length >= SEARCH_CAP && (
        <div className="notice">
          النتائج أكثر من {SEARCH_CAP} — ضيّق البحث باسم قريتك أو بمحافظتك.
        </div>
      )}
      {rows && rows.map((mosque) => (
        <article className="card" key={mosque.objectId}>
          <div className="spread">
            <h3>{mosque.name}</h3>
            {mosque.distanceKm != null
              ? <DistanceTag km={mosque.distanceKm} />
              : mosque.isClaimed && <span className="tag off">مسجّل</span>}
          </div>
          {mosque.distanceKm != null && mosque.isClaimed && (
            <span className="tag off">مسجّل</span>
          )}
          {/* القرية تميّز أكثرها، ورقم الوزارة يميّز ما تطابق فيها أيضاً */}
          <p>{mosque.governorate} — {mosque.wilayat}{mosque.village ? ` — ${mosque.village}` : ''}</p>
          {mosque.mosqueNumber && (
            <p className="when">رقم الوزارة: {mosque.mosqueNumber}</p>
          )}
          {!mosque.isClaimed && (
            <button className="ghost" onClick={() => claim(mosque)}>هذا مسجدي</button>
          )}
        </article>
      ))}
    </>
  );
}

/* ————— الإدارة ————— */

export function AdminHome() {
  const claims = useList(api.listPendingClaims);
  const contractors = useList(api.listPendingContractors);
  const [error, setError] = useState('');

  async function act(action, list, ...args) {
    setError('');
    try {
      await action(...args);
      list.refresh();
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  const review = (contractorId, approve) =>
    act(api.reviewContractor, contractors, contractorId, approve);

  return (
    <>
      <h2>طلبات ملكية المساجد</h2>
      {error && <div className="error">{error}</div>}
      <Listing state={claims} empty="لا طلبات ملكية منتظرة.">
        <div>
          {claims.rows.map((row) => (
            <article className="card" key={row.id}>
              <h3>{row.mosqueName}</h3>
              {/* المشرف يعتمد ملكية مسجدٍ بعينه، وثلاثمئة غيره تحمل الاسم نفسه */}
              <Where wilayat={row.wilayat} village={row.village}
                governorate={row.governorate} mosqueNumber={row.mosqueNumber} />
              <p>الطالب: {row.imamName || 'بلا اسم'}{row.imamPhone ? ` · ${row.imamPhone}` : ''}</p>
              {row.evidenceNote && <p>«{row.evidenceNote}»</p>}
              <div className="row">
                <button onClick={() => act(api.reviewMosqueClaim, claims, row.id, true)}>
                  اعتماد الملكية
                </button>
                <button className="ghost"
                  onClick={() => act(api.reviewMosqueClaim, claims, row.id, false)}>
                  رفض
                </button>
              </div>
            </article>
          ))}
        </div>
      </Listing>

      <h2>شركات بانتظار الاعتماد</h2>
      <Listing state={contractors} empty="لا توجد شركات منتظرة.">
        <div>
          {contractors.rows.map((row) => (
            <article className="card" key={row.id}>
              <h3>{row.companyName || row.fullName}</h3>
              <p>السجل التجاري: {row.crNumber || '— غير مُدخَل'}</p>
              <div className="row">
                <button onClick={() => review(row.id, true)}>اعتماد</button>
                <button className="ghost" onClick={() => review(row.id, false)}>رفض</button>
              </div>
            </article>
          ))}
        </div>
      </Listing>
    </>
  );
}

/* ————— الملف الشخصي ————— */

/** تعديل ما يُقرأ عن المستخدم: المهارات والمحافظة والهاتف. */
function EditProfile({ profile, onDone }) {
  const [skills, setSkills] = useState(profile.skills || []);
  const [governorate, setGovernorate] = useState(profile.governorate || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.updateMyProfile({ skills, governorate, phone });
      onDone();
    } catch (caught) {
      setError(api.messageOf(caught));
      setBusy(false);
    }
  }

  return (
    <>
      <button className="link" onClick={() => onDone()}>→ رجوع</button>
      <h2>تعديل بياناتي</h2>
      {error && <div className="error">{error}</div>}

      <Field label="رقم الهاتف" value={phone} inputMode="tel"
        onChange={(event) => setPhone(event.target.value)} />
      <Field label="المحافظة" value={governorate}
        onChange={(event) => setGovernorate(event.target.value)}
        options={{ '': '— اختر —', ...Object.fromEntries(api.GOVERNORATES.map((g) => [g, g])) }} />

      {profile.role === 'volunteer' && (
        <>
          <label>مهاراتك</label>
          <SkillPicker value={skills} onChange={setSkills} />
        </>
      )}

      <button onClick={save} disabled={busy} style={{ marginTop: 14 }}>
        {busy ? 'لحظة…' : 'حفظ'}
      </button>
    </>
  );
}

export function Profile({ onLogOut }) {
  const state = useList(api.getMyProfile);
  const [editing, setEditing] = useState(false);
  const profile = state.rows;

  if (editing && !state.loading) {
    return (
      <EditProfile profile={profile}
        onDone={() => { setEditing(false); state.refresh(); }} />
    );
  }

  return (
    <>
      <h2>حسابي</h2>
      {state.loading ? <p className="empty">جارٍ التحميل…</p> : (
        <article className="card">
          <h3>{profile.fullName || 'بلا اسم'}</h3>
          <p>الصفة: {api.ROLES[profile.role] || profile.role}</p>
          {profile.phone && <p>الهاتف: {profile.phone}</p>}
          {profile.role === 'volunteer' && (
            <>
              <p>أعمال منجزة: {profile.completedJobs}</p>
              <p>التقييم: {profile.avgRating ?? 'لا يوجد بعد'}</p>
            </>
          )}
          {profile.role === 'contractor' && (
            <>
              {profile.companyName && <p>الشركة: {profile.companyName}</p>}
              <p>السجل التجاري: {profile.crNumber || '— غير مُدخَل، راسل الإدارة'}</p>
              <p>
                الاعتماد:{' '}
                <span className={`tag ${profile.isVerifiedContractor ? 'done' : 'warn'}`}>
                  {profile.isVerifiedContractor ? 'معتمدة' : 'بانتظار المراجعة'}
                </span>
              </p>
              <p>أعمال منجزة: {profile.completedJobs}</p>
            </>
          )}
          {profile.role === 'volunteer' && (
            <p>مهاراتك: {(profile.skills || []).length
              ? profile.skills.map((k) => api.CATEGORIES[k] || k).join('، ')
              : 'غير محدّدة'}</p>
          )}
          {profile.governorate && <p>المحافظة: {profile.governorate}</p>}
          {profile.favoriteMosqueName && <p>المسجد المفضّل: {profile.favoriteMosqueName}</p>}
          {/* من سجّل مسرعاً بلا مهارات كان يبقى بلا مهارات إلى الأبد */}
          <button className="ghost" onClick={() => setEditing(true)}>تعديل بياناتي</button>
        </article>
      )}
      <button className="ghost" onClick={onLogOut}>تسجيل الخروج</button>
    </>
  );
}

/**
 * التنبيهات.
 *
 * الدفع (Parse.Push) لا يصل إلا لجهازٍ سُجّل Installation وربطه بالحساب، وهذا
 * التطبيق لا يسجّله بعد. فهذه الشاشة هي القناة التي تصل فعلاً — لا رفاهية
 * فوق الدفع بل بديله العامل.
 */
export function Notifications() {
  const [unread, setUnread] = useState(0);
  const state = useList(async () => {
    const result = await api.getMyNotifications(50);
    setUnread(result.unread);
    return result.items;
  });
  const [busy, setBusy] = useState(false);

  async function markAll() {
    setBusy(true);
    try {
      await api.markNotificationsRead();
      await state.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="spread">
        <h2 style={{ margin: 0 }}>التنبيهات</h2>
        {unread > 0 && (
          <button className="ghost" onClick={markAll} disabled={busy}>
            {busy ? 'لحظة…' : `تعليم ${unread} كمقروء`}
          </button>
        )}
      </div>

      <Listing state={state} empty="لا تنبيهات بعد.">
        <div>
          {state.rows.map((row) => (
            <article className={row.readAt ? 'card' : 'card unread'} key={row.id}>
              <p style={{ margin: 0 }}>{row.body}</p>
              <p className="when">{new Date(row.createdAt).toLocaleString('ar')}</p>
            </article>
          ))}
        </div>
      </Listing>
    </>
  );
}
