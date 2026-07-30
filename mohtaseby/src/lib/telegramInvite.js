// دعوات تليجرام بلينك — بديل الربط اليدوي بـ Chat ID
import { insertRow, listRows } from './db.js'
import { loadSettings } from './supabase.js'

const rand = () => crypto.randomUUID().replace(/-/g, '')

// إنشاء دعوة وإرجاع رابط t.me الجاهز
// targetType: 'employee' | 'supplier' | 'recipient' | 'app_user'
export async function createInvite({ targetType, targetId, name, phone, botUsername }) {
  let user = botUsername
  if (!user) user = (await loadSettings())?.telegram_bot_username
  if (!user) throw new Error('ضع اسم مستخدم البوت (Bot Username) في إعدادات الشركة أولاً')

  const code = rand()
  await insertRow('telegram_invites', {
    code,
    target_type: targetType,
    target_id: targetId || null,
    name: name || '',
    phone: phone || '',
    used: false,
  })

  return `https://t.me/${String(user).replace('@', '')}?start=inv_${code}`
}

// تحويل رقم مصري إلى صيغة wa.me
export function waNumber(phone) {
  const p = String(phone || '').replace(/\D/g, '')
  if (!p) return ''
  if (p.startsWith('20')) return p
  return '20' + p.replace(/^0/, '')
}

// نسخ الرابط + فتح واتساب برسالة جاهزة
export async function inviteAndShare({ targetType, targetId, name, phone }) {
  const link = await createInvite({ targetType, targetId, name, phone })
  try { await navigator.clipboard.writeText(link) } catch { /* الحافظة غير متاحة */ }

  const wa = waNumber(phone)
  if (wa) {
    const msg = encodeURIComponent(
      `أهلاً ${name || ''} 👋\nاضغط الرابط ده لربط حسابك بنظام IDEA 360° على تليجرام:\n${link}`
    )
    window.open(`https://wa.me/${wa}?text=${msg}`, '_blank')
  }
  return link
}

// دعوة تلقائية لكل رقم جديد في أمر شغل أو إذن خروج
// contacts: [{ name, phone, role }]
// يتخطى أي رقم مربوط بالفعل، وينشئ سجل مستلم للأرقام الجديدة
export async function autoInviteContacts(contacts) {
  const out = []
  if (!contacts?.length) return out

  const [recipients, employees] = await Promise.all([
    listRows('recipients').catch(() => []),
    listRows('employees').catch(() => []),
  ])
  const norm = (p) => String(p || '').replace(/\D/g, '').replace(/^20/, '0')

  for (const c of contacts) {
    if (!c?.phone) continue
    const key = norm(c.phone)

    // مربوط كموظف بالفعل؟
    if (employees.some((e) => norm(e.phone) === key && e.telegram_chat_id)) continue

    let rec = recipients.find((r) => norm(r.phone) === key)
    if (rec?.telegram_chat_id) continue

    if (!rec) {
      rec = await insertRow('recipients', {
        name: c.name || '', phone: c.phone, job_title: c.role || '',
      })
    }

    try {
      const link = await createInvite({
        targetType: 'recipient', targetId: rec.id, name: c.name, phone: c.phone,
      })
      out.push({ name: c.name, phone: c.phone, role: c.role, link })
    } catch (e) {
      out.push({ name: c.name, phone: c.phone, role: c.role, error: e.message })
    }
  }
  return out
}
