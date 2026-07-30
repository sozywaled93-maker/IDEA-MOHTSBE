import { useState } from 'react'
import { useLang } from '../lib/i18n.jsx'

// قائمة منسدلة + إضافة عنصر جديد + إدارة (حذف) العناصر
export default function SelectWithAdd({ value, onChange, options, onAdd, onDelete, addLabel }) {
  const { t } = useLang()
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [name, setName] = useState('')

  const confirm = async () => {
    const n = name.trim()
    if (!n) return
    const created = await onAdd(n)
    onChange(created.name_ar)
    setAdding(false); setName('')
  }

  if (adding) return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && confirm()}
        placeholder={addLabel} style={{ flex: 1 }} />
      <button type="button" className="mini-btn ok" onClick={confirm}>✓</button>
      <button type="button" className="mini-btn" onClick={() => { setAdding(false); setName('') }}>✕</button>
    </div>
  )

  if (managing) return (
    <div className="manage-list">
      {options.map((o) => (
        <div className="manage-row" key={o.id}>
          <span>{o.name_ar}</span>
          <button type="button" className="icon-btn" title={t('delete')}
            onClick={async () => { await onDelete(o.id); if (value === o.name_ar) onChange(options.find((x) => x.id !== o.id)?.name_ar || '') }}>✕</button>
        </div>
      ))}
      <button type="button" className="mini-btn" style={{ width: '100%' }} onClick={() => setManaging(false)}>{t('done')}</button>
    </div>
  )

  return (
    <select value={value} onChange={(e) => {
      if (e.target.value === '__add__') setAdding(true)
      else if (e.target.value === '__manage__') setManaging(true)
      else onChange(e.target.value)
    }}>
      {options.map((o) => <option key={o.id} value={o.name_ar}>{o.name_ar}</option>)}
      <option value="__add__">＋ {addLabel}</option>
      {onDelete && <option value="__manage__">🗑 {t('manageList')}</option>}
    </select>
  )
}
