// نظام دخول وصلاحيات على مستوى التطبيق
import { listRows } from './db.js'
import { loadSettings } from './supabase.js'

const KEY = 'idea360_session'
export const getSession = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
export const setSession = (s) => localStorage.setItem(KEY, JSON.stringify(s))
export const logout = () => { localStorage.removeItem(KEY); location.href = location.pathname }

// دخول الأدمن بكلمة السر
export async function loginAdmin(password) {
  const st = await loadSettings()
  if (!st?.admin_password) return { error: 'no_admin' }
  if (password !== st.admin_password) return { error: 'wrong' }
  const s = { name: 'Admin', is_admin: true, pages: null }
  setSession(s); return { session: s }
}

// دخول موظف برابط ?access=TOKEN (+ كلمة سر اختيارية)
export async function loginToken(token, password) {
  const users = await listRows('app_users')
  const u = users.find((x) => x.token === token)
  if (!u) return { error: 'invalid' }
  if (u.password && u.password !== password) return { error: 'need_pass' }
  const s = { name: u.name, is_admin: !!u.is_admin, pages: u.is_admin ? null : (u.allowed_pages || []), user_id: u.id, employee_id: u.employee_id }
  setSession(s); return { session: s }
}

// هل الحماية مفعّلة أصلاً؟ (كلمة سر أدمن محفوظة)
export async function authEnabled() {
  const st = await loadSettings()
  return !!st?.admin_password
}
