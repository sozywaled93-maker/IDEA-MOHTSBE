import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, updateRow } from '../../lib/db.js'
import { taxDeadline, fmtDate, daysUntil } from '../../lib/taxes.js'
import { EmptyState } from '../../components/ui.jsx'

// سجل التنبيهات الدائم: كل ما يستحق انتباهك في مكان واحد بحالته
export default function AlertsPage({ onChanged }) {
  const { t } = useLang()
  const [quotes, setQuotes] = useState([])
  const [conferences, setConferences] = useState([])
  const [manualTaxes, setManualTaxes] = useState([])
  const [permits, setPermits] = useState([])
  const [recipients, setRecipients] = useState([])

  const load = () => {
    listRows('quotes').then(setQuotes); listRows('conferences').then(setConferences)
    listRows('exit_permits').then(setPermits); listRows('recipients').then(setRecipients)
  }
  useEffect(load, [])

  const toggle = async (id, k, v) => { await updateRow('quotes', id, { [k]: v }); load(); onChanged?.() }
  const toggleMt = async (id, k, v) => { await updateRow('manual_taxes', id, { [k]: v }); load(); onChanged?.() }
  const toggleM = async (id, k, v) => { await updateRow('manual_taxes', id, { [k]: v }); load(); onChanged?.() }

  const alerts = useMemo(() => {
    const out = []
    const today = new Date(); today.setHours(0, 0, 0, 0)

    for (const q of quotes) {
      const invDate = q.date_to || q.date_from
      if (q.doc_type !== 'invoice') continue

      // الفاتورة الإلكترونية
      if (invDate && new Date(invDate) <= today) {
        out.push({
          kind: 'einvoice', quote: q, done: !!q.einvoice_done,
          date: invDate, title: `${t('einvoice')} — ${q.conference_name}`,
          action: () => toggle(q.id, 'einvoice_done', !q.einvoice_done),
        })
      }
      // الإقرار والسداد
      if (q.finished && q.is_taxable && invDate) {
        const dl = taxDeadline(invDate)
        out.push({
          kind: 'filing', quote: q, done: !!q.tax_filed, deadline: dl, left: daysUntil(dl),
          date: fmtDate(dl), title: `${t('taxFiled')} — ${q.conference_name}`,
          action: () => toggle(q.id, 'tax_filed', !q.tax_filed),
        })
        out.push({
          kind: 'payment', quote: q, done: !!q.tax_paid, deadline: dl, left: daysUntil(dl),
          date: fmtDate(dl), title: `${t('taxPaid')} — ${q.conference_name}`,
          action: () => toggle(q.id, 'tax_paid', !q.tax_paid),
        })
      }
    }
    // الضرائب اليدوية
    for (const m of manualTaxes) {
      if (!m.invoice_date) continue
      const dl = taxDeadline(m.invoice_date)
      out.push({ kind: 'filing', done: !!m.tax_filed, deadline: dl, left: daysUntil(dl),
        date: fmtDate(dl), title: `${t('taxFiled')} (${t('manualTaxes')}) — ${m.conference_name || ''}`,
        action: () => toggleM(m.id, 'tax_filed', !m.tax_filed) })
      out.push({ kind: 'payment', done: !!m.tax_paid, deadline: dl, left: daysUntil(dl),
        date: fmtDate(dl), title: `${t('taxPaid')} (${t('manualTaxes')}) — ${m.conference_name || ''}`,
        action: () => toggleM(m.id, 'tax_paid', !m.tax_paid) })
    }
    // الضرائب المسجلة يدوياً
    for (const m of manualTaxes) {
      if (!m.invoice_date) continue
      const dl = taxDeadline(m.invoice_date)
      out.push({
        kind: 'filing', done: !!m.tax_filed, deadline: dl, left: daysUntil(dl),
        date: fmtDate(dl), title: `${t('taxFiled')} — ${m.conference_name || m.client_name || t('manualTaxes')}`,
        action: () => toggleMt(m.id, 'tax_filed', !m.tax_filed),
      })
      out.push({
        kind: 'payment', done: !!m.tax_paid, deadline: dl, left: daysUntil(dl),
        date: fmtDate(dl), title: `${t('taxPaid')} — ${m.conference_name || m.client_name || t('manualTaxes')}`,
        action: () => toggleMt(m.id, 'tax_paid', !m.tax_paid),
      })
    }
    // المؤتمرات القادمة خلال ١٤ يوماً
    for (const c of conferences) {
      if (!c.date_from) continue
      const left = daysUntil(c.date_from)
      if (left >= 0 && left <= 14) {
        out.push({ kind: 'upcoming', done: false, info: true, left, date: c.date_from, title: `${t('upcomingConf')} — ${c.name}` })
      }
    }
    // أذون الخروج المتأخرة
    for (const p of permits) {
      if (p.status !== 'open' || !p.expected_return) continue
      const left = daysUntil(p.expected_return)
      if (left <= 2) {
        const rec = recipients.find((r) => r.id === p.recipient_id)
        out.push({ kind: 'permit', done: false, info: true, left, date: p.expected_return,
          title: `${t('permitReturn')} #${p.permit_number} — ${rec?.name || ''}` })
      }
    }
    // الترتيب: غير المنجز أولاً ثم الأقرب موعداً
    return out.sort((a, b) => (a.done - b.done) || ((a.left ?? 99) - (b.left ?? 99)))
  }, [quotes, conferences, manualTaxes, permits, recipients])

  const pending = alerts.filter((a) => !a.done)
  const doneList = alerts.filter((a) => a.done)

  const Row = ({ a }) => (
    <div className={`alert-row ${a.done ? 'done' : a.left !== undefined && a.left < 0 ? 'overdue' : ''}`}>
      <span className="alert-icon">
        {a.kind === 'einvoice' ? '🧾' : a.kind === 'filing' ? '📑' : a.kind === 'payment' ? '💳' : a.kind === 'permit' ? '📤' : '📅'}
      </span>
      <span style={{ flex: 1 }}>
        <b>{a.title}</b>
        <div className="hint-inline">
          {a.date}{a.left !== undefined && !a.done ? (a.left >= 0 ? ` — ${t('daysLeft')}: ${a.left}` : ` — ${t('overdue')}`) : ''}
        </div>
      </span>
      {a.info ? <span className="badge">{a.left === 0 ? t('todayLbl') : `${a.left} ${t('daysLeft')}`}</span>
        : <button className={`tax-btn ${a.done ? 'done' : ''}`} onClick={a.action}>{a.done ? '✓ ' + t('done_') : t('markDone')}</button>}
    </div>
  )

  return (
    <div>
      <h1 className="page-title">🔔 {t('alerts')}</h1>
      <p className="page-sub">{t('alertsSub')}</p>
      {alerts.length === 0 ? <EmptyState /> : (
        <>
          {pending.length > 0 && <div className="card">
            <h3>{t('pendingAlerts')} ({pending.length})</h3>
            {pending.map((a, i) => <Row a={a} key={i} />)}
          </div>}
          {doneList.length > 0 && <div className="card">
            <h3>{t('doneAlerts')} ({doneList.length})</h3>
            {doneList.map((a, i) => <Row a={a} key={i} />)}
          </div>}
        </>
      )}
    </div>
  )
}
