// طبقة إرسال موحدة: تليجرام وواتساب (WhatsApp Cloud API) — حسب قنوات الإرسال المفعّلة في الإعدادات
import { tgSend } from './telegram.js'

export async function waSend(token, phoneId, to, text) {
  if (!token || !phoneId) throw new Error('لم يتم ضبط بيانات واتساب في إعدادات الشركة')
  if (!to) throw new Error('لا يوجد رقم واتساب لهذا المستلم')
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'فشل إرسال واتساب')
  return data
}

// يرسل عبر القنوات المفعّلة حسب settings، ويعيد ملخص النتيجة
export async function sendMessage(settings, target, text) {
  const results = []
  const useTg = settings?.send_via_telegram !== false
  const useWa = !!settings?.send_via_whatsapp

  if (useTg && target.telegram_chat_id) {
    try { await tgSend(settings.telegram_bot_token, target.telegram_chat_id, text); results.push({ ch: 'telegram', ok: true }) }
    catch (e) { results.push({ ch: 'telegram', ok: false, error: e.message }) }
  }
  if (useWa && (target.whatsapp_number || target.phone)) {
    try {
      await waSend(settings.whatsapp_api_token, settings.whatsapp_phone_id, target.whatsapp_number || target.phone, text)
      results.push({ ch: 'whatsapp', ok: true })
    } catch (e) { results.push({ ch: 'whatsapp', ok: false, error: e.message }) }
  }
  if (results.length === 0) throw new Error('لا توجد قناة إرسال مفعّلة أو بيانات اتصال لهذا المستلم')
  return results
}
