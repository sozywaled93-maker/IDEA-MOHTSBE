import { useEffect, useState } from 'react'
import { LangProvider, useLang } from './lib/i18n.jsx'
import CompanySettingsPage from './modules/settings/CompanySettingsPage.jsx'
import ContactsPage from './modules/contacts/ContactsPage.jsx'
import LibraryPage from './modules/equipment/LibraryPage.jsx'
import PublicStatement from './modules/public/PublicStatement.jsx'
import QuotesPage from './modules/quotes/QuotesPage.jsx'
import ConferencesPage from './modules/conferences/ConferencesPage.jsx'
import ReceiptsPage from './modules/receipts/ReceiptsPage.jsx'
import CostsPage from './modules/costs/CostsPage.jsx'
import TreasuryPage from './modules/treasury/TreasuryPage.jsx'
import AccountsPage from './modules/accounts/AccountsPage.jsx'
import TaxesPage from './modules/taxes/TaxesPage.jsx'
import TasksPage from './modules/tasks/TasksPage.jsx'
import WorkOrdersPage from './modules/workorders/WorkOrdersPage.jsx'
import DashboardPage from './modules/dashboard/DashboardPage.jsx'
import AlertsPage from './modules/alerts/AlertsPage.jsx'
import InventoryPage from './modules/inventory/InventoryPage.jsx'
import { listRows, updateRow } from './lib/db.js'
import { buildReminders } from './lib/taxes.js'
import { getSession, setSession, loginAdmin, loginToken, authEnabled, logout } from './lib/auth.js'
import { loadSettings } from './lib/supabase.js'
import UpcomingWidget from './components/UpcomingWidget.jsx'

const NAV = [
  { id: 'dashboard', icon: '📊' },
  { id: 'conferences', icon: '🎪' },
  { id: 'quotes', icon: '📄' },
  { id: 'treasury', icon: '🏦' },
  { id: 'accounts', icon: '💼' },
  { id: 'taxes', icon: '🧮' },
  { id: 'alerts', icon: '🔔' },
  { id: 'tasks', icon: '✅' },
  { id: 'workorders', icon: '🧾' },
  { id: 'contacts', icon: '👥' },
  { id: 'inventory', icon: '📦' },
  { id: 'equipment', icon: '🗂️' },  // مكتبة البنود
  { id: 'receipts', icon: '🧾' },
  { id: 'settings', icon: '⚙️' },
]

function LoginGate({ children }) {
  const { t, dir } = useLang()
  const [ready, setReady] = useState(false)
  const [needs, setNeeds] = useState(false)
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const token = new URLSearchParams(location.search).get('access')

  useEffect(() => {
    (async () => {
      // إذا كان الرابط يحمل توكن دخول جديداً، أعطه الأولوية دائماً وتجاهل أي جلسة قديمة محفوظة —
      // وإلا يبقى المستخدم محتفظاً بصلاحيات الموظف السابق حتى لو فتح رابط موظف آخر
      if (token) {
        const r = await loginToken(token, '')
        if (r.session) { history.replaceState(null, '', location.pathname); setReady(true); return }
        if (r.error === 'need_pass') { setNeeds('token'); return }
        // توكن غير صالح: تجاهله والمتابعة بالتحقق من الجلسة الحالية إن وُجدت
      }
      if (getSession()) { setReady(true); return }
      if (await authEnabled()) setNeeds('admin')
      else { setSession({ name: 'Admin', is_admin: true, pages: null }); setReady(true) }
    })()
  }, [])

  const go = async () => {
    const r = needs === 'token' ? await loginToken(token, pass) : await loginAdmin(pass)
    if (r.session) { history.replaceState(null, '', location.pathname); setReady(true) }
    else setErr(t('wrongPass'))
  }

  if (ready) return children
  if (!needs) return null
  return (
    <div className="public-page" dir={dir} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 360, textAlign: 'center' }}>
        <img src="/assets/logo.png" style={{ height: 64 }} alt="" />
        <h2 style={{ margin: '10px 0 2px' }}>IDEA 360°</h2>
        <p className="hint-inline">IDEA-EG | OS v1</p>
        <div className="field" style={{ textAlign: 'start', marginTop: 14 }}>
          <label>{t('password')}</label>
          <input type="password" dir="ltr" autoFocus value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        {err && <p style={{ color: '#A32D2D', fontSize: 13 }}>{err}</p>}
        <button className="save-btn" style={{ width: '100%' }} onClick={go}>{t('login')}</button>
      </div>
    </div>
  )
}

function Shell() {
  const { t, lang, setLang, dir } = useLang()
  const session = getSession()
  const canSee = (id) => !session || session.is_admin || session.pages === null || (session.pages || []).includes(id)
  const [page, setPage] = useState('dashboard')
  const [reminders, setReminders] = useState([])

  useEffect(() => {
    const h = (e) => setPage(e.detail.page)
    window.addEventListener('app-goto', h)
    return () => window.removeEventListener('app-goto', h)
  }, [])

  const [confAlerts, setConfAlerts] = useState([])
  const [tickerOn, setTickerOn] = useState(true)

  const refreshConfAlerts = async () => {
    const confs = await listRows('conferences').catch(() => [])
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const out = []
    for (const c of confs) {
      if (!c.date_from) continue
      const left = Math.ceil((new Date(c.date_from) - today) / 864e5)
      if (left >= 0 && left <= 14) out.push({ msg: `📅 ${t('upcomingConf')}: ${c.name} — ${left === 0 ? t('todayLbl') : `${left} ${t('daysLeft')}`}` })
    }
    setConfAlerts(out)
  }

  const refreshReminders = () => Promise.all([listRows('quotes'), listRows('manual_taxes')])
    .then(([q, m]) => setReminders(buildReminders(q, m)))
  useEffect(() => {
    refreshReminders(); refreshConfAlerts()
    document.title = 'IDEA 360° — IDEA-EG | OS v1'
    loadSettings().then((s) => setTickerOn(s?.show_alerts_ticker !== false))
  }, [page])

  const snooze = async (r) => {
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
    const table = r.table === 'manual_taxes' ? 'manual_taxes' : 'quotes'
    try { await updateRow(table, r.quote.id, { snooze_until: tomorrow }) } catch (e) { console.error(e) }
    refreshReminders()
  }
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useEffect(() => { setMobileNavOpen(false) }, [page])   // إغلاق القائمة تلقائياً بعد اختيار صفحة على الموبايل
  const [showUpcomingWidget, setShowUpcomingWidget] = useState(true)
  useEffect(() => { loadSettings().then((s) => setShowUpcomingWidget(s?.show_upcoming_widget !== false)) }, [])

  return (
    <div className="app" dir={dir}>
      <button className="mobile-menu-btn" onClick={() => setMobileNavOpen((v) => !v)} aria-label="menu">☰</button>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/assets/logo.png" alt="IDEA" />
          <div>
            <b>IDEA 360°</b>
            <div className="brand-sub">IDEA-EG | OS v1</div>
          </div>
        </div>
        {NAV.filter((n) => canSee(n.id)).map((n) => (
          <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            <span>{n.icon}</span> {t(n.id)}
          </button>
        ))}
        {session && <div className="hint-inline" style={{ color: '#B7B1AA', padding: '4px 10px' }}>👤 {session.name}
          <button className="icon-btn" style={{ color: '#B7B1AA', fontSize: 12 }} title={t('logout')} onClick={logout}>⎋</button></div>}
        <button className="lang-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'English' : 'العربية'}
        </button>
      </aside>
      <main className="main">
        {showUpcomingWidget && <UpcomingWidget session={session} />}
        {reminders.filter((r) => r.level === 'big').map((r, i) => (
          <div key={i} className="alert alert-big">
            <span>🚨 {r.msg}</span>
            <span className="alert-actions">
              <button onClick={() => setPage('taxes')}>{t('goTaxes')}</button>
            </span>
          </div>
        ))}
        {tickerOn && (reminders.some((r) => r.level !== 'big') || confAlerts.length > 0) && (
          <div className="ticker-wrap" onClick={() => setPage('alerts')} style={{ cursor: 'pointer' }}>
            <div className="ticker-track">
              {[...reminders.filter((r) => r.level !== 'big'), ...confAlerts].map((r, i) => (
                <span className="ticker-item" key={i}>🔴 {r.msg}</span>
              ))}
            </div>
          </div>
        )}
        {page === 'settings' && <CompanySettingsPage />}
        {page === 'contacts' && <ContactsPage />}
        {page === 'equipment' && <LibraryPage />}
        {page === 'quotes' && <QuotesPage />}
        {page === 'conferences' && <ConferencesPage />}
        {page === 'receipts' && <ReceiptsPage />}
        {page === 'costs' && <CostsPage />}
        {page === 'treasury' && <TreasuryPage />}
        {page === 'accounts' && <AccountsPage />}
        {page === 'taxes' && <TaxesPage onChanged={refreshReminders} />}
        {page === 'tasks' && <TasksPage />}
        {page === 'workorders' && <WorkOrdersPage />}
        {page === 'dashboard' && <DashboardPage />}
        {page === 'alerts' && <AlertsPage onChanged={refreshReminders} />}
        {page === 'inventory' && <InventoryPage />}
      </main>
    </div>
  )
}

export default function App() {
  const token = new URLSearchParams(location.search).get('supplier')
  if (token) return <LangProvider><PublicStatement token={token} /></LangProvider>
  return <LangProvider><LoginGate><Shell /></LoginGate></LangProvider>
}


