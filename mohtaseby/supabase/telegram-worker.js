/**
 * ================================================================
 * IDEA 360° — Telegram Bot Webhook (Cloudflare Worker) — v3.5
 * ================================================================
 * مطابق حرفياً لـ schema.sql + telegram-upgrade.sql
 *
 * المزايا:
 *  🧾 أوامر الشغل      — الموظف يشوف المسند له / الأدمن يشوف الكل
 *  🔑 فتح أمر شغل      — الموظف يبعت المفتاح فيشوف التفاصيل والبنود
 *  📦 أذون خروج المخازن — للأدمن (جدول exit_permits)
 *  💼 الحسابات والمصاريف — للأدمن + الموظف المصرّح له
 *  💰 تسجيل مصروف      — يختار إيفنت ثم يبعت "1000 بنزين"
 *  🔗 الدعوة بلينك      — t.me/BOT?start=inv_CODE
 *  ❌ اتشال /linkadmin نهائياً
 *
 * النشر:
 *  1) Cloudflare → Workers & Pages → Create Worker → Edit code → الصق الملف
 *  2) عدّل الأربع قيم تحت
 *  3) Save and deploy
 *  4) https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>
 * ================================================================
 */

const BOT_TOKEN = 'ضع_توكن_البوت_هنا'
const SUPABASE_URL = 'https://xxxxxxxxxxxxx.supabase.co'
// ⚠️ service_role key — البوت بيكتب في الجداول
const SUPABASE_KEY = 'ضع_مفتاح_service_role_هنا'

/* ================================================================ */
export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('IDEA 360 Telegram Webhook v3.5 is running', { status: 200 })
    }
    try {
      const update = await request.json()
      if (update.callback_query) await handleCallback(update.callback_query)
      else if (update.message) await handleMessage(update.message)
    } catch (err) {
      console.error('Webhook error:', err)
    }
    return new Response('ok', { status: 200 })
  },
}

/* ================================================================
 * الرسائل الواردة
 * ================================================================ */
async function handleMessage(message) {
  const chatId = String(message.chat.id)
  const firstName = message.chat.first_name || ''
  const text = (message.text || '').trim()

  if (message.contact && message.contact.phone_number) {
    await clearState(chatId)
    return linkByPhone(chatId, normalizePhone(message.contact.phone_number), firstName)
  }

  if (text.startsWith('/start')) {
    const payload = text.replace('/start', '').trim()
    await clearState(chatId)
    if (payload.startsWith('inv_')) return acceptInvite(chatId, payload.slice(4), firstName)
    return requestPhoneShare(chatId, firstName)
  }

  // وسط عملية جارية
  const st = await getState(chatId)
  if (st.state === 'expense_amount') {
    if (text === '❌ إنهاء التسجيل') {
      await clearState(chatId)
      return sendMsg(chatId, '✅ تم إنهاء تسجيل المصاريف.')
    }
    return saveExpenseFromText(chatId, text, st.data || {})
  }
  if (st.state === 'awaiting_order_key') {
    await clearState(chatId)
    return sendWorkOrderByKey(chatId, text)
  }

  switch (text) {
    case '📋 مهامي':                return sendMyTasks(chatId)
    case '🎪 الإيفنتات القادمة':    return sendUpcomingEvents(chatId)
    case '⚠️ تنبيهات الضرائب':      return sendTaxAlerts(chatId)
    case '🧾 أوامر الشغل':          return sendWorkOrders(chatId)
    case '📦 أذون خروج المخازن':    return sendExitPermits(chatId)
    case '💼 الحسابات والمصاريف':   return sendFinance(chatId)
    case '💰 تسجيل مصروف':          return startExpenseFlow(chatId)
    case '🔑 فتح أمر شغل':
      await setState(chatId, 'awaiting_order_key', {})
      return sendMsg(chatId, '🔑 ابعت مفتاح أمر الشغل (زي <code>A1B2C3</code>) وهجيبلك كل تفاصيله.')
  }

  // كود أمر شغل مباشر بدون ضغط الزر
  if (/^[A-Za-z0-9\-_]{4,20}$/.test(text)) {
    if (await sendWorkOrderByKey(chatId, text, true)) return
  }

  await sendMsg(chatId, 'اختار من الأزرار تحت 👇')
}

/* ================================================================
 * الأزرار الداخلية
 * ================================================================ */
async function handleCallback(cq) {
  const data = cq.data || ''
  const chatId = String(cq.message.chat.id)
  const messageId = cq.message.message_id

  if (data.startsWith('taskDone:')) {
    const ok = await updateRow('tasks', data.slice(9), {
      done: true, completed_via_bot: true, completed_at: new Date().toISOString(),
    })
    await answerCallback(cq.id, ok ? '✅ تم تسجيل الإنجاز' : '⚠️ حصل خطأ، حاول تاني')
    if (ok) await editMessage(chatId, messageId, (cq.message.text || '') + '\n\n✅ تم الإنجاز')
    return
  }

  if (data.startsWith('wo:')) {
    await answerCallback(cq.id, '')
    return sendWorkOrderById(chatId, data.slice(3))
  }

  if (data.startsWith('ep:')) {
    await answerCallback(cq.id, '')
    return sendExitPermitById(chatId, data.slice(3))
  }

  if (data.startsWith('expEvent:')) {
    const confId = data.slice(9)
    const conf = (await fetchTable('conferences')).find((c) => c.id === confId)
    await setState(chatId, 'expense_amount', { conference_id: confId, conference_name: conf?.name || '' })
    await answerCallback(cq.id, '')
    return sendMsg(chatId,
      '🎪 الإيفنت: <b>' + esc(conf?.name || '—') + '</b>\n\n' +
      '💰 ابعت المصروف كده:\n<code>1000 بنزين</code>\n<code>500 فطار</code>\n\n' +
      'كل رسالة = مصروف جديد يتسجل على الإيفنت ده.',
      expenseKeyboard())
  }
}

function expenseKeyboard() {
  return { keyboard: [[{ text: '❌ إنهاء التسجيل' }]], resize_keyboard: true }
}

/* ================================================================
 * الكيبورد حسب الصلاحية
 * ================================================================ */
async function buildKeyboard(chatId) {
  const who = await whoIs(chatId)
  const rows = [[{ text: '📋 مهامي' }, { text: '🎪 الإيفنتات القادمة' }]]

  if (who.admin || who.employee) {
    rows.push([{ text: '🧾 أوامر الشغل' }, { text: '🔑 فتح أمر شغل' }])
  }

  if (who.admin) {
    rows.push([{ text: '📦 أذون خروج المخازن' }, { text: '⚠️ تنبيهات الضرائب' }])
    rows.push([{ text: '💼 الحسابات والمصاريف' }, { text: '💰 تسجيل مصروف' }])
  } else if (who.employee) {
    const fin = []
    if (who.employee.can_view_finance) fin.push({ text: '💼 الحسابات والمصاريف' })
    if (who.employee.can_view_finance || who.employee.can_log_expense) fin.push({ text: '💰 تسجيل مصروف' })
    if (fin.length) rows.push(fin)
  }

  return { keyboard: rows, resize_keyboard: true }
}

// بيرجع { admin, employee } — مع كاش داخل نفس الطلب
async function whoIs(chatId) {
  const users = await fetchTable('app_users')
  const admin = users.find((u) => u.is_admin && String(u.telegram_chat_id) === chatId)
  const emps = await fetchTable('employees')
  const employee = emps.find((e) => String(e.telegram_chat_id) === chatId)
  return { admin, employee }
}

/* ================================================================
 * أوامر الشغل
 * ================================================================ */
async function sendWorkOrders(chatId) {
  const who = await whoIs(chatId)
  if (!who.admin && !who.employee) return sendMsg(chatId, 'حسابك غير مربوط بعد. اضغط /start.')

  const all = await fetchTable('work_orders')
  const list = who.admin ? all : all.filter((w) => w.employee_id === who.employee.id)

  if (!list.length) {
    return sendMsg(chatId, who.admin ? '📭 لا توجد أوامر شغل مسجلة.' : '📭 لا توجد أوامر شغل مسندة لك حالياً.')
  }

  const confs = await fetchTable('conferences')
  list.sort((a, b) => (b.wo_number || 0) - (a.wo_number || 0))

  const buttons = list.slice(0, 40).map((w) => {
    const c = confs.find((x) => x.id === w.conference_id)
    const icon = w.status === 'done' ? '✅' : w.status === 'cancelled' ? '🚫' : w.status === 'in_progress' ? '🔧' : '🟡'
    return [{
      text: icon + ' #' + w.wo_number + ' ' + (w.title || c?.name || 'بدون عنوان'),
      callback_data: 'wo:' + w.id,
    }]
  })

  await sendMsg(chatId,
    '🧾 <b>' + (who.admin ? 'كل أوامر الشغل' : 'أوامر الشغل المسندة لك') + '</b> (' + list.length + ')\n\nاختار أمر لعرض تفاصيله:',
    undefined, { inline_keyboard: buttons })
}

async function sendWorkOrderById(chatId, id) {
  const wo = (await fetchTable('work_orders')).find((w) => w.id === id)
  if (!wo) return sendMsg(chatId, '⚠️ أمر الشغل غير موجود.')

  const who = await whoIs(chatId)
  if (!who.admin && (!who.employee || wo.employee_id !== who.employee.id)) {
    return sendMsg(chatId, '⚠️ أمر الشغل ده مش مسند ليك.')
  }

  const [items, confs, clients, emps, venues] = await Promise.all([
    fetchTable('work_order_items'), fetchTable('conferences'),
    fetchTable('clients'), fetchTable('employees'), fetchTable('venues'),
  ])

  const conf = confs.find((c) => c.id === wo.conference_id)
  const client = clients.find((c) => c.id === wo.client_id)
  const emp = emps.find((e) => e.id === wo.employee_id)
  const venue = venues.find((v) => v.id === wo.venue_id)
  const myItems = items.filter((i) => i.work_order_id === wo.id)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const statusTxt = { open: '🟡 مفتوح', in_progress: '🔧 جارٍ التنفيذ', done: '✅ منتهي', cancelled: '🚫 ملغي' }

  const lines = [
    '🧾 <b>أمر شغل #' + wo.wo_number + (wo.title ? ' — ' + esc(wo.title) : '') + '</b>',
    '🔑 المفتاح: <code>' + esc(wo.order_key) + '</code>',
    conf ? '🎪 الإيفنت: ' + esc(conf.name) : '',
    client ? '👤 العميل: ' + esc(client.company_name) : '',
    venue ? '🏨 المكان: ' + esc(venue.hotel_name) + (venue.hall_name ? ' — ' + esc(venue.hall_name) : '') : (wo.location ? '📍 المكان: ' + esc(wo.location) : ''),
    wo.date_from ? '📅 ' + wo.date_from + (wo.date_to ? ' ← ' + wo.date_to : '') : '',
    wo.setup_time ? '🛠 التجهيز: ' + esc(wo.setup_time) : '',
    wo.start_time ? '⏰ البداية: ' + esc(wo.start_time) : '',
    emp ? '👷 المسؤول: ' + esc(emp.name) + (emp.job_title ? ' (' + esc(emp.job_title) + ')' : '') : '',
    '📌 الحالة: ' + (statusTxt[wo.status] || wo.status),
  ].filter(Boolean)

  if (myItems.length) {
    lines.push('\n<b>📋 البنود (' + myItems.length + '):</b>')
    myItems.forEach((it, i) => {
      lines.push(
        (it.done ? '✅ ' : '▫️ ') + (i + 1) + '. <b>' + esc(it.item_name) + '</b> — ' +
        num(it.qty) + ' ' + esc(it.unit || '') +
        (Number(it.days) > 1 ? ' × ' + num(it.days) + ' يوم' : '') +
        (it.note ? '\n     📝 ' + esc(it.note) : '')
      )
    })
  }

  const contacts = Array.isArray(wo.contacts) ? wo.contacts : []
  if (contacts.length) {
    lines.push('\n<b>📞 أرقام التواصل:</b>')
    contacts.forEach((c) => {
      lines.push('• ' + esc(c.name || '') + (c.role ? ' (' + esc(c.role) + ')' : '') + ' — <code>' + esc(c.phone || '') + '</code>')
    })
  }

  if (wo.notes) lines.push('\n📝 ملاحظات: ' + esc(wo.notes))

  await sendMsg(chatId, lines.join('\n'))
}

async function sendWorkOrderByKey(chatId, key, silent) {
  const wo = (await fetchTable('work_orders'))
    .find((w) => (w.order_key || '').toLowerCase() === key.toLowerCase())
  if (!wo) {
    if (!silent) await sendMsg(chatId, '⚠️ مفيش أمر شغل بالمفتاح ده: <code>' + esc(key) + '</code>')
    return false
  }
  await sendWorkOrderById(chatId, wo.id)
  return true
}

/* ================================================================
 * أذون خروج المخازن (exit_permits) — للأدمن
 * ================================================================ */
async function sendExitPermits(chatId) {
  const who = await whoIs(chatId)
  if (!who.admin) return sendMsg(chatId, '⚠️ الخاصية دي للإدارة فقط.')

  const permits = await fetchTable('exit_permits')
  if (!permits.length) return sendMsg(chatId, '📭 لا توجد أذون خروج مسجلة.')

  permits.sort((a, b) => (b.permit_number || 0) - (a.permit_number || 0))
  const confs = await fetchTable('conferences')

  const buttons = permits.slice(0, 40).map((p) => {
    const c = confs.find((x) => x.id === p.conference_id)
    const units = Array.isArray(p.unit_ids) ? p.unit_ids.length : 0
    return [{
      text: (p.status === 'closed' ? '✅' : '📤') + ' إذن #' + p.permit_number + ' — ' +
            (p.recipient_name || c?.name || '—') + ' (' + units + ' قطعة)',
      callback_data: 'ep:' + p.id,
    }]
  })

  await sendMsg(chatId, '📦 <b>أذون خروج المخازن</b> (' + permits.length + ')\n\nاختار إذن لعرض تفاصيله:',
    undefined, { inline_keyboard: buttons })
}

async function sendExitPermitById(chatId, id) {
  const who = await whoIs(chatId)
  if (!who.admin) return sendMsg(chatId, '⚠️ الخاصية دي للإدارة فقط.')

  const p = (await fetchTable('exit_permits')).find((x) => x.id === id)
  if (!p) return sendMsg(chatId, '⚠️ الإذن غير موجود.')

  const [confs, emps, units, items, recips] = await Promise.all([
    fetchTable('conferences'), fetchTable('employees'),
    fetchTable('inventory_units'), fetchTable('inventory_items'),
    fetchTable('recipients'),
  ])
  const rec = recips.find((r) => r.id === p.recipient_id)

  const conf = confs.find((c) => c.id === p.conference_id)
  const emp = emps.find((e) => e.id === p.employee_id)
  // القطع: من unit_ids أو من inventory_units.permit_id (البرنامج يستخدم الاثنين)
  let unitIds = Array.isArray(p.unit_ids) ? p.unit_ids : []
  if (!unitIds.length) unitIds = units.filter((u) => u.permit_id === p.id).map((u) => u.id)
  const returned = Array.isArray(p.returned_ids) ? p.returned_ids : []

  const typeTxt = { rent: 'إيجار', conference: 'مؤتمر', internal: 'داخلي' }

  const lines = [
    '📦 <b>إذن خروج #' + p.permit_number + '</b>',
    '📌 النوع: ' + (typeTxt[p.exit_type] || p.exit_type),
    conf ? '🎪 الإيفنت: ' + esc(conf.name) : '',
    (p.recipient_name || rec?.name) ? '👤 المستلم: ' + esc(p.recipient_name || rec.name) +
      (p.recipient_job ? ' — ' + esc(p.recipient_job) : '') +
      (p.recipient_company ? ' (' + esc(p.recipient_company) + ')' : '') : '',
    (p.recipient_phone || rec?.phone) ? '📞 ' + esc(p.recipient_phone || rec.phone) : '',
    emp ? '👷 المسؤول: ' + esc(emp.name) : '',
    '📅 الخروج: ' + (p.exit_date || p.date_out || '—') +
      ((p.expected_return || p.due_date) ? ' | الإرجاع: ' + (p.expected_return || p.due_date) : ''),
    '📊 الحالة: ' + (p.status === 'closed' ? '✅ مقفول' : '🟡 مفتوح') +
      ' — رجع ' + returned.length + ' من ' + unitIds.length,
  ].filter(Boolean)

  if (unitIds.length) {
    lines.push('\n<b>📋 القطع:</b>')
    unitIds.slice(0, 40).forEach((uid) => {
      const u = units.find((x) => x.id === uid)
      const it = u ? items.find((x) => x.id === u.item_id) : null
      lines.push((returned.includes(uid) ? '✅ ' : '📤 ') +
        esc(it?.name || 'صنف') +
        (u?.barcode ? ' — <code>' + esc(u.barcode) + '</code>' : '') +
        (u?.serial ? ' | S/N: ' + esc(u.serial) : ''))
    })
    if (unitIds.length > 40) lines.push('… و' + (unitIds.length - 40) + ' قطعة أخرى')
  }

  if (p.notes) lines.push('\n📝 ' + esc(p.notes))

  await sendMsg(chatId, lines.join('\n'))
}

/* ================================================================
 * الحسابات والمصاريف
 * ================================================================ */
async function sendFinance(chatId) {
  const who = await whoIs(chatId)
  if (!who.admin && !(who.employee && who.employee.can_view_finance)) {
    return sendMsg(chatId, '⚠️ ملكش صلاحية على الحسابات والمصاريف. كلّم الإدارة تفعّلهالك.')
  }

  const [expenses, incomes, confs] = await Promise.all([
    fetchTable('expenses'), fetchTable('incomes'), fetchTable('conferences'),
  ])

  const byEvent = {}
  let totalExp = 0
  for (const e of expenses) {
    const amt = Number(e.amount) || 0
    totalExp += amt
    const k = e.conference_id || 'none'
    if (!byEvent[k]) byEvent[k] = { exp: 0, inc: 0, count: 0 }
    byEvent[k].exp += amt
    byEvent[k].count++
  }
  let totalInc = 0
  for (const i of incomes) {
    const amt = Number(i.amount) || 0
    totalInc += amt
  }

  const lines = Object.entries(byEvent)
    .sort((a, b) => b[1].exp - a[1].exp)
    .slice(0, 15)
    .map(([id, v]) => {
      const c = confs.find((x) => x.id === id)
      return '🎪 <b>' + esc(c?.name || 'بدون إيفنت') + '</b>\n   💸 ' + money(v.exp) + ' — ' + v.count + ' بند'
    })

  await sendMsg(chatId,
    '💼 <b>الحسابات والمصاريف</b>\n\n' +
    '💰 إجمالي الإيرادات: <b>' + money(totalInc) + '</b>\n' +
    '💸 إجمالي المصاريف: <b>' + money(totalExp) + '</b>\n' +
    '📊 الصافي: <b>' + money(totalInc - totalExp) + '</b>\n' +
    '📋 عدد بنود المصاريف: ' + expenses.length + '\n\n' +
    '<b>المصاريف حسب الإيفنت:</b>\n\n' + lines.join('\n\n'))
}

/* ================================================================
 * تسجيل مصروف
 * ================================================================ */
async function startExpenseFlow(chatId) {
  const who = await whoIs(chatId)
  if (!who.admin && !(who.employee && (who.employee.can_log_expense || who.employee.can_view_finance))) {
    return sendMsg(chatId, '⚠️ ملكش صلاحية تسجيل مصاريف. كلّم الإدارة تفعّلهالك.')
  }

  const confs = await fetchTable('conferences')
  if (!confs.length) return sendMsg(chatId, '📭 لا توجد إيفنتات مسجلة.')

  confs.sort((a, b) => new Date(b.date_from || 0) - new Date(a.date_from || 0))
  const buttons = confs.slice(0, 40).map((c) => [{
    text: '🎪 ' + c.name + (c.date_from ? ' — ' + c.date_from : ''),
    callback_data: 'expEvent:' + c.id,
  }])

  await sendMsg(chatId, '💰 <b>تسجيل مصروف</b>\n\nاختار الإيفنت الأول:', undefined, { inline_keyboard: buttons })
}

// يفهم: "1000 بنزين" / "بنزين 1000" / "500 فطار للفريق"
function parseExpense(text) {
  const m = text.match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  const amount = Number(m[1].replace(',', '.'))
  if (!amount || amount <= 0) return null
  const desc = text.replace(m[0], '').trim().replace(/^[-—:،]+/, '').trim()
  return { amount, desc: desc || 'مصروف' }
}

async function saveExpenseFromText(chatId, text, data) {
  const parsed = parseExpense(text)
  if (!parsed) {
    return sendMsg(chatId, '⚠️ مش فاهم. اكتب المبلغ والبيان كده:\n<code>1000 بنزين</code>', expenseKeyboard())
  }

  const who = await whoIs(chatId)

  // شاشة الخزنة في البرنامج تفلتر بـ quote_id — نربط المصروف بأقرب عرض للإيفنت
  let quoteId = null
  if (data.conference_id) {
    const q = (await fetchTable('quotes')).find((x) => x.conference_id === data.conference_id)
    quoteId = q ? q.id : null
  }

  const ok = await insertRow('expenses', {
    expense_type: quoteId ? 'event' : 'general',
    conference_id: data.conference_id || null,
    quote_id: quoteId,
    name: parsed.desc,
    amount: parsed.amount,
    expense_date: new Date().toISOString().slice(0, 10),
    notes: 'مسجل من تليجرام' + (who.employee ? ' — ' + who.employee.name : ''),
    source: 'telegram',
    created_by_emp_id: who.employee ? who.employee.id : null,
    handed_to: who.employee ? who.employee.id : null,
  })

  if (!ok) return sendMsg(chatId, '⚠️ حصلت مشكلة في الحفظ. حاول تاني.', expenseKeyboard())

  await sendMsg(chatId,
    '✅ <b>اتسجل</b>\n' +
    '🎪 ' + esc(data.conference_name || '—') + '\n' +
    '💸 ' + money(parsed.amount) + ' — ' + esc(parsed.desc) + '\n\n' +
    'ابعت مصروف تاني، أو اضغط "❌ إنهاء التسجيل".',
    expenseKeyboard())
}

/* ================================================================
 * الدعوات بلينك
 * ================================================================ */
async function acceptInvite(chatId, code, firstName) {
  const inv = (await fetchTable('telegram_invites')).find((i) => i.code === code)
  if (!inv) return sendMsg(chatId, '⚠️ رابط الدعوة غير صالح. كلّم الإدارة.', null)
  if (inv.used && String(inv.chat_id) !== chatId) {
    return sendMsg(chatId, '⚠️ رابط الدعوة ده اتستخدم قبل كده.', null)
  }

  const table = { supplier: 'suppliers', recipient: 'recipients', app_user: 'app_users' }[inv.target_type] || 'employees'
  const now = new Date().toISOString()

  if (inv.target_id) {
    await updateRow(table, inv.target_id, { telegram_chat_id: chatId, telegram_linked_at: now })
  }
  await updateRow('telegram_invites', inv.id, { used: true, used_at: now, chat_id: chatId })

  await sendMsg(chatId,
    'أهلاً <b>' + esc(inv.name || firstName) + '</b> 👋\n\n' +
    'تم ربط حسابك بنجاح بنظام <b>IDEA 360°</b>.\n' +
    'استخدم الأزرار تحت في أي وقت.')
}

/* ================================================================
 * الربط بالرقم (طريقة احتياطية)
 * ================================================================ */
async function linkByPhone(chatId, phone, firstName) {
  const now = new Date().toISOString()
  const targets = [
    { table: 'employees',  nameCol: 'name',          msg: 'تم ربط حسابك بنجاح بنظام <b>IDEA 360°</b>.' },
    { table: 'suppliers',  nameCol: 'supplier_name', msg: 'تم ربط حسابكم كمورد معتمد لدى <b>IDEA 360°</b>.' },
    { table: 'recipients', nameCol: 'name',          msg: 'تم ربط حسابك. هتوصلك إشعارات الاستلام وتذكيرات الإرجاع.' },
  ]

  for (const t of targets) {
    const row = (await fetchTable(t.table)).find((r) => phoneMatches(r, phone))
    if (row) {
      await updateRow(t.table, row.id, { telegram_chat_id: chatId, telegram_linked_at: now })
      return sendMsg(chatId, 'مرحباً <b>' + esc(row[t.nameCol] || firstName) + '</b> 👋\n\n' + t.msg)
    }
  }

  await sendMsg(chatId,
    'مرحباً ' + esc(firstName) + ' 👋\n\n' +
    'رقمك مش مسجل عندنا في نظام IDEA 360°.\nبرجاء التواصل مع الإدارة.', null)
}

async function requestPhoneShare(chatId, firstName) {
  await tg('sendMessage', {
    chat_id: chatId,
    text: 'أهلاً ' + esc(firstName) + ' 👋\n\nمرحباً بك في نظام <b>IDEA 360°</b>.\nاضغط الزر تحت لمشاركة رقمك وربط حسابك تلقائياً.',
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [[{ text: '📱 مشاركة رقم الهاتف وربط الحساب', request_contact: true }]],
      resize_keyboard: true, one_time_keyboard: true,
    },
  })
}

/* ================================================================
 * المهام / الإيفنتات / الضرائب
 * ================================================================ */
async function sendMyTasks(chatId) {
  const who = await whoIs(chatId)
  if (!who.employee) return sendMsg(chatId, 'حسابك غير مربوط كموظف. اضغط /start.')

  const mine = (await fetchTable('tasks')).filter((t) => t.employee_id === who.employee.id && !t.done)
  if (!mine.length) return sendMsg(chatId, '✅ لا توجد لديك مهام معلّقة حالياً.')

  const [quotes, confs] = await Promise.all([fetchTable('quotes'), fetchTable('conferences')])

  for (const task of mine) {
    const q = quotes.find((x) => x.id === task.quote_id)
    const conf = q ? confs.find((c) => c.id === q.conference_id) : null
    const text = [
      '📋 <b>' + esc(task.title || 'مهمة بدون عنوان') + '</b>',
      'الإيفنت: ' + esc(conf?.name || q?.conference_name || 'مهمة عامة'),
      task.note ? 'ملاحظات: ' + esc(task.note) : '',
    ].filter(Boolean).join('\n')

    await tg('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '✅ تم التنفيذ', callback_data: 'taskDone:' + task.id }]] },
    })
  }
}

async function sendUpcomingEvents(chatId) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = (await fetchTable('conferences'))
    .filter((c) => c.date_from && new Date(c.date_from) >= today)
    .sort((a, b) => new Date(a.date_from) - new Date(b.date_from))

  if (!upcoming.length) return sendMsg(chatId, '📭 لا توجد إيفنتات قادمة حالياً.')

  const lines = upcoming.slice(0, 10).map((c) => {
    const left = Math.ceil((new Date(c.date_from) - today) / 86400000)
    const when = left === 0 ? 'اليوم' : left === 1 ? 'غداً' : 'بعد ' + left + ' يوم'
    return '🎪 <b>' + esc(c.name) + '</b>\n📅 ' + c.date_from + (c.date_to ? ' ← ' + c.date_to : '') +
      ' (' + when + ')' + (c.location ? '\n📍 ' + esc(c.location) : '')
  })
  await sendMsg(chatId, lines.join('\n\n'))
}

function taxDeadline(dateStr) {
  const d = new Date(dateStr)
  return new Date(d.getFullYear(), d.getMonth() + 2, 0)
}

async function sendTaxAlerts(chatId) {
  const who = await whoIs(chatId)
  if (!who.admin) return sendMsg(chatId, '⚠️ الخاصية دي للإدارة فقط.')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const alerts = []

  for (const q of await fetchTable('quotes')) {
    if (q.doc_type !== 'invoice' || !q.finished || !q.is_taxable) continue
    const invDate = q.date_to || q.date_from
    if (!invDate || (q.tax_filed && q.tax_paid)) continue
    const dl = taxDeadline(invDate)
    alerts.push({ name: q.conference_name || 'بدون اسم', deadline: dl,
      left: Math.ceil((dl - today) / 86400000), filed: !!q.tax_filed, paid: !!q.tax_paid })
  }
  for (const m of await fetchTable('manual_taxes')) {
    if (!m.invoice_date || (m.tax_filed && m.tax_paid)) continue
    const dl = taxDeadline(m.invoice_date)
    alerts.push({ name: m.conference_name || m.client_name || 'ضريبة يدوية', deadline: dl,
      left: Math.ceil((dl - today) / 86400000), filed: !!m.tax_filed, paid: !!m.tax_paid })
  }

  if (!alerts.length) return sendMsg(chatId, '✅ لا توجد التزامات ضريبية معلّقة حالياً.')

  alerts.sort((a, b) => a.left - b.left)
  const lines = alerts.slice(0, 20).map((a) => {
    const when = a.left < 0 ? 'متأخر ' + Math.abs(a.left) + ' يوم ⚠️' : a.left === 0 ? 'اليوم' : 'باقي ' + a.left + ' يوم'
    return '🎪 <b>' + esc(a.name) + '</b>\n📅 آخر موعد: ' + a.deadline.toISOString().slice(0, 10) + ' (' + when + ')\n' +
      '📑 الإقرار: ' + (a.filed ? '✅ تم' : '❌ لم يُرفع') + '\n💳 السداد: ' + (a.paid ? '✅ تم' : '❌ لم يُسدَّد')
  })
  await sendMsg(chatId, lines.join('\n\n'))
}

/* ================================================================
 * أدوات
 * ================================================================ */
function money(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ج.م' }
function num(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function normalizePhone(phone) {
  let p = String(phone).replace(/[^\d]/g, '')
  if (p.startsWith('20')) p = '0' + p.slice(2)
  if (!p.startsWith('0')) p = '0' + p
  return p
}

function phoneMatches(record, targetPhone) {
  if (record.phone && normalizePhone(record.phone) === targetPhone) return true
  if (Array.isArray(record.phones)) {
    return record.phones.some((p) => p && p.number && normalizePhone(p.number) === targetPhone)
  }
  return false
}

/* --- حالة المحادثة --- */
async function getState(chatId) {
  const rows = await sbGet('bot_state?chat_id=eq.' + encodeURIComponent(chatId))
  return rows[0] || { state: '', data: {} }
}
async function setState(chatId, state, data) {
  await sbFetch('bot_state?on_conflict=chat_id', 'POST',
    { chat_id: chatId, state, data, updated_at: new Date().toISOString() },
    { Prefer: 'resolution=merge-duplicates,return=minimal' })
}
async function clearState(chatId) { await setState(chatId, '', {}) }

/* --- Supabase --- */
function sbHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  }, extra || {})
}
async function sbFetch(path, method, body, extraHeaders) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers: sbHeaders(extraHeaders), body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) console.error('Supabase ' + method + ' ' + path, res.status, await res.clone().text())
  return res
}
async function sbGet(path) {
  try { return await (await sbFetch(path, 'GET')).json() } catch (e) { return [] }
}
async function fetchTable(table) { return sbGet(table + '?select=*') }
async function updateRow(table, id, patch) {
  return (await sbFetch(table + '?id=eq.' + id, 'PATCH', patch, { Prefer: 'return=minimal' })).ok
}
async function insertRow(table, row) {
  return (await sbFetch(table, 'POST', row, { Prefer: 'return=minimal' })).ok
}

/* --- Telegram --- */
async function tg(method, payload) {
  return fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
}
// keyboard: undefined = القائمة الافتراضية | null = بدون | كائن = مخصص
async function sendMsg(chatId, text, keyboard, inline) {
  const markup = inline ? inline
    : keyboard === undefined ? await buildKeyboard(chatId)
    : keyboard === null ? undefined : keyboard
  await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: markup })
}
async function answerCallback(id, text) {
  await tg('answerCallbackQuery', { callback_query_id: id, text: text || '', show_alert: false })
}
async function editMessage(chatId, messageId, text) {
  await tg('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' })
}
