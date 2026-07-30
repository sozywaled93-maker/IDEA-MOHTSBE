import { useEffect, useRef, useState } from 'react'
import { useDirty } from '../../lib/useDirty.js'
import { useLang } from '../../lib/i18n.jsx'
import { listRows, insertRow, updateRow, deleteRow, uploadDoc, openFile } from '../../lib/db.js'
import { Modal, ConfirmDelete, EmptyState } from '../../components/ui.jsx'
import ViewDetails from '../../components/ViewDetails.jsx'
import { viewFile } from '../../components/viewFile.js'

const empty = {
  company_name: '', contact_person: '', phone: '', email: '', address: '',
  commercial_reg_no: '', tax_card_no: '', cr_image_url: null, tax_card_image_url: null,
}

function DocUpload({ label, value, onChange, t }) {
  const ref = useRef(null)
  const pick = async (f) => {
    if (!f) return
    try { onChange(await uploadDoc('client-docs', f, `${Date.now()}-${f.name}`)) }
    catch (e) { alert(e.message) }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="upload-box" style={{ minHeight: 110 }}
        onClick={() => !value && ref.current.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}>
        {value ? (
          <>
            {value.startsWith('data:application/pdf') || value.endsWith('.pdf')
              ? <span style={{ fontSize: 30 }}>📄</span>
              : <img src={value} alt={label} style={{ maxHeight: 60 }} />}
            <div className="upload-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => openFile(value)}>{t('view')}</button>
              <button onClick={() => ref.current.click()}>{t('replace')}</button>
              <button className="danger" onClick={() => onChange(null)}>{t('remove')}</button>
            </div>
          </>
        ) : (
          <span className="hint">📎 {t('uploadHint')}</span>
        )}
        <input hidden ref={ref} type="file" accept="image/png,image/jpeg,application/pdf"
          onChange={(e) => pick(e.target.files[0])} />
      </div>
    </div>
  )
}

export default function ClientsTab() {
  const { t } = useLang()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [formOriginal, setFormOriginal] = useState(null)
  const isDirty = useDirty(form, formOriginal)
  const [viewRow, setViewRow] = useState(null)
  const [del, setDel] = useState(null)
  const [q, setQ] = useState('')

  const load = () => listRows('clients').then(setRows)
  useEffect(() => { load() }, [])
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!form.company_name.trim()) return alert(t('required') + ': ' + t('clientCompany'))
    try {
      if (form.id) await updateRow('clients', form.id, form)
      else await insertRow('clients', form)
      setForm(null); load()
    } catch (e) { alert(e.message) }
  }

  const filtered = rows.filter((r) =>
    (r.company_name + ' ' + (r.contact_person || '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="toolbar">
        <input className="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="save-btn" onClick={() => { setForm({ ...empty }); setFormOriginal({ ...empty }) }}>+ {t('addClient')}</button>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <div className="cards-grid">
          {filtered.map((r) => (
            <div className="entity-card" key={r.id}>
              <div className="entity-head">
                <b>{r.company_name}</b>
                {(r.cr_image_url || r.tax_card_image_url) && <span className="badge ok">📎</span>}
              </div>
              {r.contact_person && <div className="entity-sub">{r.contact_person}</div>}
              <div className="entity-meta">
                {r.phone && <span dir="ltr">📞 {r.phone}</span>}
                {r.email && <span dir="ltr">✉️ {r.email}</span>}
                {r.commercial_reg_no && <span>{t('crNo')}: {r.commercial_reg_no}</span>}
                {r.tax_card_no && <span>{t('taxCardNo')}: {r.tax_card_no}</span>}
              </div>
              <div className="entity-actions">
                <button onClick={() => setViewRow(r)}>👁 {t('view')}</button>
                <button onClick={() => { setForm({ ...r }); setFormOriginal({ ...r }) }}>{t('edit')}</button>
                <button className="danger" onClick={() => setDel(r.id)}>{t('delete')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal title={form.id ? t('edit') : t('addClient')} onClose={() => setForm(null)} wide
          dirty={isDirty} onSaveAndClose={save}>
          <div className="grid2">
            <div className="field"><label>{t('clientCompany')} *</label>
              <input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
            <div className="field"><label>{t('contactPerson')}</label>
              <input value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></div>
            <div className="field"><label>{t('phone')}</label>
              <input dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="field"><label>{t('email')}</label>
              <input dir="ltr" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>{t('address')}</label>
              <input value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="field"><label>{t('crNo')}</label>
              <input dir="ltr" value={form.commercial_reg_no} onChange={(e) => set('commercial_reg_no', e.target.value)} /></div>
            <div className="field"><label>{t('taxCardNo')}</label>
              <input dir="ltr" value={form.tax_card_no} onChange={(e) => set('tax_card_no', e.target.value)} /></div>
            <DocUpload label={t('crImage')} value={form.cr_image_url} onChange={(v) => set('cr_image_url', v)} t={t} />
            <DocUpload label={t('taxCardImage')} value={form.tax_card_image_url} onChange={(v) => set('tax_card_image_url', v)} t={t} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="save-btn" onClick={save}>{t('save')}</button>
          </div>
        </Modal>
      )}

      {viewRow && (
        <ViewDetails title={viewRow.company_name} onClose={() => setViewRow(null)} rows={[
          { label: t('contactPerson'), value: viewRow.contact_person },
          { label: t('phone'), value: viewRow.phone, ltr: true },
          { label: t('email'), value: viewRow.email, ltr: true },
          { label: t('address'), value: viewRow.address },
          { label: t('crNo'), value: viewRow.commercial_reg_no, ltr: true },
          { label: t('taxCardNo'), value: viewRow.tax_card_no, ltr: true },
        ]} />
      )}
      {del && <ConfirmDelete onCancel={() => setDel(null)}
        onConfirm={async () => { await deleteRow('clients', del); setDel(null); load() }} />}
    </div>
  )
}
