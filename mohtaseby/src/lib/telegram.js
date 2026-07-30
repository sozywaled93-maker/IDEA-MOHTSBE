// إرسال رسائل تليجرام مباشرة من المتصفح عبر Bot API
// buttons (اختياري): [[{ text, callback_data }]] — صف من الأزرار تحت الرسالة
export async function tgSend(token, chatId, text, buttons) {
  if (!token) throw new Error('لم يتم ضبط توكن بوت التليجرام في إعدادات الشركة')
  if (!chatId) throw new Error('هذا الموظف غير مربوط بالتليجرام (chat id فارغ)')
  const body = { chat_id: chatId, text, parse_mode: 'HTML' }
  if (buttons) body.reply_markup = { inline_keyboard: buttons }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.description || 'فشل الإرسال')
  return data
}

export function eventMessage(q) {
  const days = q.date_from && q.date_to
    ? Math.max(1, Math.round((new Date(q.date_to) - new Date(q.date_from)) / 864e5) + 1) : null
  return [
    `📅 <b>${q.conference_name || 'إيفنت'}</b>`,
    q.date_from ? `التاريخ: ${q.date_from}${q.date_to ? ' ← ' + q.date_to : ''}` : null,
    days ? `عدد الأيام: ${days}` : null,
    q.location ? `المكان: ${q.location}` : null,
  ].filter(Boolean).join('\n')
}

export function taskMessage(task, q) {
  return [
    `✅ <b>مهمة جديدة</b>`,
    `الإيفنت: ${q?.conference_name || '—'}`,
    `المهمة: ${task.title || '—'}`,
    task.note ? `ملاحظات: ${task.note}` : null,
    q?.date_from ? `موعد الإيفنت: ${q.date_from}` : null,
    q?.location ? `المكان: ${q.location}` : null,
  ].filter(Boolean).join('\n')
}

// جلب المستخدمين الذين ضغطوا Start في البوت
export async function tgGetChats(token) {
  if (!token) throw new Error('ضع توكن البوت أولاً واحفظ الإعدادات')
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.description || 'فشل الاتصال بالبوت — تأكد من صحة التوكن')
  const chats = {}
  for (const u of data.result || []) {
    const c = u.message?.chat || u.my_chat_member?.chat
    const contact = u.message?.contact   // يظهر فقط إذا شارك المستخدم رقمه فعلياً مع البوت (زر Share Contact)
    if (c && c.type === 'private') {
      chats[c.id] = {
        id: String(c.id),
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id),
        username: c.username ? '@' + c.username : '',
        phone: contact?.phone_number ? contact.phone_number.replace(/^\+?20?/, '0') : (chats[c.id]?.phone || ''),
      }
    }
  }
  return Object.values(chats)
}
