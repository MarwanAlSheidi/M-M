import { useCallback, useEffect, useState } from 'react';
import * as api from './api';

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
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await api.logIn(form.username, form.password);
      else await api.signUp(form);
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

/* ————— المتطوّع ————— */

export function Opportunities() {
  const state = useList(api.openOpportunities);
  const [message, setMessage] = useState('');

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
      <h2>فرص التطوّع المفتوحة</h2>
      {message && <div className="notice">{message}</div>}
      <Listing state={state} empty="لا توجد فرص مفتوحة الآن.">
        <div>
          {state.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.title}</h3>
                <StatusTag status={row.status} />
              </div>
              <p>{row.mosqueName} — {row.wilayat}</p>
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

export function MyVolunteering() {
  const interests = useList(api.getMyInterests);
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
      <Listing state={tasks} empty="لم يُسنَد إليك عمل بعد.">
        <div>
          {tasks.rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="spread">
                <h3>{row.title}</h3>
                <StatusTag status={row.status} />
              </div>
              <p>{row.mosqueName}</p>
              {row.status === 'assigned' && (
                <button onClick={() => act(api.startWork, row.id)}>بدأت العمل</button>
              )}
              {row.status === 'in_progress' && (
                <button onClick={() => act(api.markWorkDone, row.id, 'أُنجز العمل.')}>
                  أنجزتُ العمل
                </button>
              )}
              {row.status === 'pending_imam_approval' && <p>بانتظار معاينة الإمام واعتماده.</p>}
            </article>
          ))}
        </div>
      </Listing>

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
  );
}

/* ————— الإمام ————— */

export function ImamHome() {
  const claims = useList(api.getMyClaims);
  const approved = claims.rows.filter((claim) => claim.status === 'approved');
  const [openMosque, setOpenMosque] = useState(null);

  if (openMosque) {
    return <MosqueRequests mosque={openMosque} onBack={() => setOpenMosque(null)} />;
  }

  return (
    <>
      <h2>مساجدي</h2>
      <Listing state={claims} empty="لم تسجّل مسجداً بعد — ابحث عنه من تبويب «تسجيل مسجد».">
        <div>
          {claims.rows.map((claim) => (
            <article className="card" key={claim.id}>
              <div className="spread">
                <h3>{claim.mosqueName}</h3>
                <span className={`tag ${claim.status === 'approved' ? 'done'
                  : claim.status === 'rejected' ? 'off' : 'warn'}`}>
                  {claim.status === 'approved' ? 'معتمد'
                    : claim.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                </span>
              </div>
              <p>{claim.wilayat}</p>
              {claim.status === 'approved' && (
                <button onClick={() => setOpenMosque(claim)}>طلبات الصيانة</button>
              )}
              {claim.status === 'pending' && <p>سيراجع المشرف طلبك خلال أيام عمل.</p>}
            </article>
          ))}
        </div>
      </Listing>
      {approved.length === 0 && claims.rows.length > 0 && (
        <p className="empty">لا يمكن إنشاء طلبات قبل اعتماد ملكية المسجد.</p>
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
                  <p>مهارات: {row.skills.length ? row.skills.join('، ') : 'غير محدّدة'}</p>
                  <p>أعمال منجزة: {row.completedJobs}</p>
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

      {status === 'pending_imam_approval' && (
        <>
          <h2>معاينة واعتماد</h2>
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

export function ClaimMosque() {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function search(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      setRows(await api.searchMosques(term));
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
      <form onSubmit={search} className="row">
        <input value={term} onChange={(event) => setTerm(event.target.value)}
          placeholder="ابحث باسم المسجد" style={{ flex: 1 }} />
        <button type="submit">بحث</button>
      </form>

      {error && <div className="error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {rows && rows.length === 0 && <p className="empty">لا نتائج.</p>}
      {rows && rows.map((mosque) => (
        <article className="card" key={mosque.objectId}>
          <div className="spread">
            <h3>{mosque.name}</h3>
            {mosque.isClaimed && <span className="tag off">مسجّل</span>}
          </div>
          <p>{mosque.governorate} — {mosque.wilayat}</p>
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
  const contractors = useList(api.listPendingContractors);
  const [error, setError] = useState('');

  async function review(contractorId, approve) {
    setError('');
    try {
      await api.reviewContractor(contractorId, approve);
      contractors.refresh();
    } catch (caught) {
      setError(api.messageOf(caught));
    }
  }

  return (
    <>
      <h2>شركات بانتظار الاعتماد</h2>
      {error && <div className="error">{error}</div>}
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

export function Profile({ onLogOut }) {
  const state = useList(api.getMyProfile);
  const profile = state.rows;

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
          {profile.favoriteMosqueName && <p>المسجد المفضّل: {profile.favoriteMosqueName}</p>}
        </article>
      )}
      <button className="ghost" onClick={onLogOut}>تسجيل الخروج</button>
    </>
  );
}
