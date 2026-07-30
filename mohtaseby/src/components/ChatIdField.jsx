import { useState } from 'react'
import { useLang } from '../lib/i18n.jsx'
import { loadSettings } from '../lib/supabase.js'

// حقل Chat ID + زر "سحب" يفتح قائمة من ضغطوا Start في البوت ليختار منها
// لو تم تمرير phone، يحاول مطابقة تلقائية مع من شارك نفس الرقم مع البوت (contact.phone_number)
export default function ChatIdField({ label, value, onChange, phone }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [autoMsg, setAutoMsg] = useState('')

  const normalize = (p) => (p || '').replace(/[^\d]/g, '').replace(/^20/, '0').replace(/^0*/, '')

  const fetchChats = async () => {
    setLoading(true)
    setAutoMsg('')
    try {
      const settings = await loadSettings()
      const { tgGetChats } = await import('../lib/telegram.js')
      const list = await tgGetChats(settings?.telegram_bot_token)
      setChats(list)
      // مطابقة تلقائية بالرقم لو متاح
      if (phone) {
        const match = list.find((c) => c.phone && normalize(c.phone) === normalize(phone))
        if (match) {
          onChange(match.id)
          setAutoMsg(`✓ ${t('autoMatchedByPhone')}: ${match.name}`)
          setOpen(false)
          setLoading(false)
          return
        }
      }
      setOpen(true)
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input dir="ltr" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Chat ID" style={{ flex: 1 }} />
        <button type="button" className="mini-btn tg" onClick={fetchChats} disabled={loading}>
          {loading ? '...' : `📥 ${t('pullChatId')}`}
        </button>
      </div>
      {autoMsg && <p className="hint-inline" style={{ color: '#0F6E56' }}>{autoMsg}</p>}
      {open && chats && (
        <div className="manage-list" style={{ marginTop: 6 }}>
          {chats.length === 0 ? <p className="hint-inline">{t('noTgUsers')}</p> : chats.map((c) => (
            <div className="manage-row" key={c.id}>
              <span>{c.name} {c.username} <small className="hint-inline" dir="ltr">({c.id})</small></span>
              <button type="button" className="mini-btn ok" onClick={() => { onChange(c.id); setOpen(false) }}>{t('use')}</button>
            </div>
          ))}
          <button type="button" className="mini-btn" style={{ width: '100%' }} onClick={() => setOpen(false)}>{t('done')}</button>
        </div>
      )}
    </div>
  )
}
