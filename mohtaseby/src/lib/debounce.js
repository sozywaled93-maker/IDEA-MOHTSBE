import { updateRow } from './db.js'

// حفظ مؤجل: يجمع التعديلات ويرسلها بعد توقف الكتابة — يحل بطء الكتابة نهائياً
const timers = {}
const pending = {}

export function debSave(table, id, patch, delay = 700) {
  const key = `${table}:${id}`
  pending[key] = { ...(pending[key] || {}), ...patch }
  clearTimeout(timers[key])
  timers[key] = setTimeout(async () => {
    const p = pending[key]; delete pending[key]
    try { await updateRow(table, id, p) } catch {}
  }, delay)
}
