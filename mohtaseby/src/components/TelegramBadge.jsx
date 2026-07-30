import { useState } from 'react'
import { useLang } from '../lib/i18n.jsx'
import { inviteAndShare } from '../lib/telegramInvite.js'

// علامة تحت اسم الموظف توضّح مين مربوط بالتليجرام
export function TelegramBadge({ row, small }) {
  const { t } = useLang()
  const linked = !!String(row?.telegram_chat_id || '').trim()
  const since = row?.telegram_linked_at
    ? new Date(row.telegram_linked_at).toLocaleDateString('ar-EG')
    : ''
  return (
    <span
      className={`tg-badge ${linked ? 'on' : 'off'} ${small ? 'sm' : ''}`}
      title={linked ? `${t('tgLinked')}${since ? ' — ' + since : ''}` : t('tgNotLinked')}
    >
      {linked ? `✈️ ${t('tgLinked')}` : `⚪ ${t('tgNotLinked')}`}
    </span>
  )
}

// زر إرسال دعوة بلينك تليجرام
export function TelegramInviteButton({ targetType = 'employee', row, onDone, label }) {
  const { t } = useLang()
  const [busy, setBusy] = useState(false)

  const go = async (e) => {
    e?.stopPropagation()
    setBusy(true)
    try {
      const link = await inviteAndShare({
        targetType,
        targetId: row.id,
        name: row.name || row.supplier_name || '',
        phone: row.phone || (row.phones || []).find((p) => p.is_primary)?.number || '',
      })
      alert(`✓ ${t('inviteCreated')}\n\n${link}`)
      onDone?.(link)
    } catch (err) {
      alert(err.message)
    }
    setBusy(false)
  }

  return (
    <button type="button" className="mini-btn tg" onClick={go} disabled={busy}>
      {busy ? '...' : `🔗 ${label || t('sendInvite')}`}
    </button>
  )
}

export default TelegramBadge
