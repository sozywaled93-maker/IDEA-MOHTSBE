import { useEffect, useState } from 'react'
import { useDirty } from '../../lib/useDirty.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow } from '../../lib/db.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import ViewDetails from '../../components/ViewDetails.jsx'

const empty = { governorate: '', hotel_name: '', address: '', location_url: '', halls: [], contacts: [], notes: '' }
const emptyHall = { name: '', floor: '', max_height: '', max_width: '', notes: '' }
const emptyContact = { name: '', phone: '', role: 'بانكيت' }

export default function VenuesTab() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [formOriginal, setFormOriginal] = useState(null)
  const isDirty = useDirty(form, formOriginal)
  const [viewRow, setViewRow] = useState(null)
  const [del, setDel] = useState(null)
  const [q, setQ] = useState('')

  const load = () => listRows('venues').then(setRows)
  useEffect(() => { load() }, [])
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.hotel_name.trim()) return alert(t('required') + ': ' + t('hotelName'))
    const payload = {
      ...form,
      halls: (form.halls || []).filter((h) => h.name.trim()),
      contacts: (form.contacts || []).filter((c) => c.name.trim() || c.phone.trim()),
    }
    try {
      if (form.id) await updateRow('venues', form.id, payload)
      else await insertRow('venues', payload)
      setForm(null); load()
    } catch (e) { alert(e.message) }
  }

  const filtered = rows.filter((r) =>
    (r.hotel_name + ' ' + (r.governorate || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="save-btn" onClick={() => { setForm({ ...empty }); setFormOriginal({ ...empty }) }}>+ {t('addVenue')}</button>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {filtered.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>{r.hotel_name}</b>
                {r.governorate && <span className="badge">{r.governorate}</span>}
              </div>
              {r.address && <div className="entity-sub">📍 {r.address}</div>}
              <div className="entity-meta">
                {(r.halls || []).map((h, i) => (
                  <span key={i}>🏛 {h.name}{h.floor && ` — ${t('floor')} ${h.floor}`}
                    {(h.max_width || h.max_height) && ` (${h.max_width || '؟'}×${h.max_height || '؟'} م)`}</span>
                ))}
                {(r.contacts || []).map((c, i) => (
                  <span key={'c' + i} dir="auto">☎ {c.name} {c.role && `(${c.role})`} <span dir="ltr">{c.phone}</span></span>
                ))}
              </div>
              <div className="entity-actions">
                {r.location_url && <button onClick={() => window.open(r.location_url, '_blank')}>🗺 {t('locationLink')}</button>}
                <button onClick={() => setViewRow(r)}>👁 {t('view')}</button>
                <button onClick={() => { const f = { ...r, halls: r.halls || [], contacts: r.contacts || [] }; setForm(f); setFormOriginal(f) }}>{t('edit')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('edit') : t('addVenue')} onClose={() => setForm(null)} wide
          dirty={isDirty} onSaveAndClose={save}>
          <div className="grid2">
            <div className="field"><label>{t('hotelName')} *</label>
              <input value={form.hotel_name} onChange={(e) => set('hotel_name', e.target.value)} /></div>
            <div className="field"><label>{t('governorate')}</label>
              <input value={form.governorate} onChange={(e) => set('governorate', e.target.value)} placeholder="القاهرة / الجيزة / الإسكندرية..." /></div>
            <div className="field"><label>{t('address')}</label>
              <input value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="field"><label>{t('locationLink')}</label>
              <input dir="ltr" value={form.location_url} onChange={(e) => set('location_url', e.target.value)} placeholder="https://maps.google.com/..." /></div>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label>{t('halls_')}</label>
            {(form.halls || []).map((h, i) => (
              <div className="venue-hall-row" key={i}>
                <input placeholder={t('hallName')} value={h.name}
                  onChange={(e) => set('halls', (form.halls || []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input placeholder={t('floor')} value={h.floor}
                  onChange={(e) => set('halls', (form.halls || []).map((x, j) => j === i ? { ...x, floor: e.target.value } : x))} />
                <input dir="ltr" placeholder={t('maxWidth')} value={h.max_width}
                  onChange={(e) => set('halls', (form.halls || []).map((x, j) => j === i ? { ...x, max_width: e.target.value } : x))} />
                <input dir="ltr" placeholder={t('maxHeight')} value={h.max_height}
                  onChange={(e) => set('halls', (form.halls || []).map((x, j) => j === i ? { ...x, max_height: e.target.value } : x))} />
                <input placeholder={t('notes')} value={h.notes}
                  onChange={(e) => set('halls', (form.halls || []).map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
                <button type="button" className="icon-btn" onClick={() => set('halls', (form.halls || []).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
              onClick={() => set('halls', [...(form.halls || []), { ...emptyHall }])}>+ {t('addHall')}</button>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label>{t('venueContacts')}</label>
            {(form.contacts || []).map((c, i) => (
              <div className="sub-item-row" key={i} style={{ gridTemplateColumns: '1fr 150px 140px 36px' }}>
                <input placeholder={t('contactPerson')} value={c.name}
                  onChange={(e) => set('contacts', (form.contacts || []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input dir="ltr" placeholder={t('phone')} value={c.phone}
                  onChange={(e) => set('contacts', (form.contacts || []).map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} />
                <input placeholder={t('role')} value={c.role}
                  onChange={(e) => set('contacts', (form.contacts || []).map((x, j) => j === i ? { ...x, role: e.target.value } : x))} />
                <button type="button" className="icon-btn" onClick={() => set('contacts', (form.contacts || []).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="add-btn" style={{ padding: '7px 14px', fontSize: 13 }}
              onClick={() => set('contacts', [...(form.contacts || []), { ...emptyContact }])}>+ {t('addContact')}</button>
          </div>

          <div className="field" style={{ marginTop: 12 }}><label>{t('notes')}</label>
            <input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {viewRow && (
        <ViewDetails title={viewRow.hotel_name} onClose={() => setViewRow(null)} rows={[
          { label: t('governorate'), value: viewRow.governorate },
          { label: t('address'), value: viewRow.address },
          { label: t('locationLink'), value: viewRow.location_url, ltr: true },
          { label: t('notes'), value: viewRow.notes },
        ]} extra={
          (viewRow.halls || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <b style={{ fontSize: 13.5 }}>{t('hallName')}:</b>
              {(viewRow.halls || []).map((h, i) => (
                <div className="view-row" key={i}>
                  <span className="view-label">{h.name} {h.floor ? `(${t('floor')} ${h.floor})` : ''}</span>
                  <span className="view-value">{h.max_width || '—'}×{h.max_height || '—'} م</span>
                </div>
              ))}
            </div>
          )
        } />
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('venues', del); setDel(null); load() }} />}
    </div>
  )
}
