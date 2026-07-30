import { useEffect, useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow, uploadDoc } from '../../lib/db.js'
import { fmt } from '../../lib/tafqeet.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'

const empty = { name: '', date_from: '', date_to: '', governorate: '', venue_id: '', hall_name: '', location: '', notes: '', agenda_url: null }

export default function ConferencesPage() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [venues, setVenues] = useState([])
  const [quotes, setQuotes] = useState([])
  const [form, setForm] = useState(null)
  const [del, setDel] = useState(null)
  const [q, setQ] = useState('')
  const [qr, setQr] = useState(null)

  const load = () => listRows('conferences').then(setRows)
  useEffect(() => { load(); listRows('venues').then(setVenues); listRows('quotes').then(setQuotes) }, [])
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const pickVenue = (vid) => {
    const v = venues.find((x) => x.id === vid)
    setForm((p) => ({
      ...p, venue_id: vid,
      ...(v ? {
        governorate: p.governorate || v.governorate || '',
        hall_name: p.hall_name || v.hall_name || '',
        location: p.location || v.hotel_name || '',
      } : {}),
    }))
  }

  const save = async () => {
    if (!form.name.trim()) return alert(t('required') + ': ' + t('confName'))
    if (form.id) await updateRow('conferences', form.id, form)
    else await insertRow('conferences', form)
    setForm(null); load()
  }

  const confQuotes = (cid) => quotes.filter((x) => x.conference_id === cid)
  const filtered = rows.filter((r) => (r.name + ' ' + (r.location || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <h1 className="page-title">{t('conferences')}</h1>
      <p className="page-sub">{t('conferencesSub')}</p>
      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="save-btn" onClick={() => setForm({ ...empty })}>+ {t('addConference')}</button>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {filtered.map((r) => {
            const qs = confQuotes(r.id)
            const total = qs.filter((x) => x.doc_type === 'invoice').reduce((s, x) => s + (+x.grand_total || 0), 0)
            return (
              <div className="entity-card" key={r.id}>
                <div className="entity-head">
                  <b>{r.name}</b>
                  {qs.length > 0 && <span className="badge">{qs.length} {t('proposals')}</span>}
                </div>
                {r.date_from && <ConfCountdown date={r.date_from} t={t} />}
                <div className="entity-meta">
                  <span>📅 {r.date_from || '—'} {r.date_to ? '← ' + r.date_to : ''}</span>
                  <span>📍 {[r.governorate, r.location, r.hall_name].filter(Boolean).join(' · ') || '—'}</span>
                  {total > 0 && <span><b>{fmt(total)} EGP</b></span>}
                  {r.notes && <span>📝 {r.notes}</span>}
                </div>
                <div className="entity-actions">
                  <button onClick={() => setForm({ ...empty, ...r })}>{t('edit')}</button>
                  {r.agenda_url && (
                    <button onClick={async () => {
                      const QRCode = (await import('qrcode')).default
                      setQr({ name: r.name, url: r.agenda_url, img: await QRCode.toDataURL(r.agenda_url, { width: 280, margin: 1 }) })
                    }}>🔗 {t('agendaQr')}</button>
                  )}
                  <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('edit') : t('addConference')} onClose={() => setForm(null)} wide>
          <div className="grid2">
            <div className="field"><label>{t('confName')} *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="field"><label>{t('venues')}</label>
              <select value={form.venue_id || ''} onChange={(e) => pickVenue(e.target.value)}>
                <option value="">— {t('placeHint')} —</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.hotel_name}{v.hall_name ? ` — ${v.hall_name}` : ''}</option>)}
              </select></div>
            <div className="field"><label>{t('dateFrom')}</label>
              <input type="date" value={form.date_from || ''} onChange={(e) => set('date_from', e.target.value)} /></div>
            <div className="field"><label>{t('dateTo')}</label>
              <input type="date" value={form.date_to || ''} onChange={(e) => set('date_to', e.target.value)} /></div>
            <div className="field"><label>{t('governorate')}</label>
              <input value={form.governorate || ''} onChange={(e) => set('governorate', e.target.value)} /></div>
            <div className="field"><label>{t('place')}</label>
              <input value={form.location || ''} onChange={(e) => set('location', e.target.value)} /></div>
            <div className="field"><label>{t('hallName')}</label>
              <input value={form.hall_name || ''} onChange={(e) => set('hall_name', e.target.value)} /></div>
            <div className="field"><label>{t('notes')}</label>
              <input value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>{t('agenda')} (PDF)</label>
              {form.agenda_url ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="badge ok">📎 {t('agendaUploaded')}</span>
                  <button type="button" className="mini-btn" onClick={() => window.open(form.agenda_url)}>{t('view')}</button>
                  <button type="button" className="mini-btn" style={{ color: '#A32D2D' }} onClick={() => set('agenda_url', null)}>{t('remove')}</button>
                </div>
              ) : (
                <input type="file" accept="application/pdf,image/png,image/jpeg"
                  onChange={async (e) => {
                    const f0 = e.target.files[0]
                    if (f0) set('agenda_url', await uploadDoc('client-docs', f0, f0.name))
                  }} />
              )}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {qr && (
        <Modal title={`${t('agendaQr')} — ${qr.name}`} onClose={() => setQr(null)}>
          <div style={{ textAlign: 'center' }}>
            <img src={qr.img} alt="QR" />
            <p style={{ fontSize: 13 }}>{t('agendaQrHint')}</p>
            <button className="mini-btn" onClick={() => { navigator.clipboard.writeText(qr.url); alert('✓') }}>📋 {t('copyLink')}</button>
          </div>
        </Modal>
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('conferences', del); setDel(null); load() }} />}
    </div>
  )
}

// عد تنازلي بسيط لموعد المؤتمر
export function ConfCountdown({ date, t }) {
  const left = Math.ceil((new Date(date) - new Date().setHours(0, 0, 0, 0)) / 864e5)
  if (left < 0) return <div className="countdown-chip done">✓ {t('confPassed')}</div>
  return (
    <div className={`countdown-chip ${left <= 3 ? 'urgent' : ''}`}>
      ⏳ {left === 0 ? t('todayLbl') : `${left} ${t('daysLeft')}`}
    </div>
  )
}
