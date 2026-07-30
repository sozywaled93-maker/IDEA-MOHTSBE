import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n.jsx'
import { listRows, updateRow } from '../lib/db.js'

// ودجت "أقرب معاد إيفنت + تاسكاتي" — يظهر للأدمن ولأي موظف ثابت (emp_type = permanent) فقط،
// ويمكن للأدمن إخفاؤه بالكامل عبر سويتش في الإعدادات
export default function UpcomingWidget({ session }) {
  const { t } = useLang()
  const [conferences, setConferences] = useState([])
  const [tasks, setTasks] = useState([])
  const [myEmployee, setMyEmployee] = useState(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    listRows('conferences').then(setConferences)
    listRows('tasks').then(setTasks)
    if (session?.employee_id) {
      listRows('employees').then((emps) => setMyEmployee(emps.find((e) => e.id === session.employee_id)))
    }
  }, [session?.employee_id])

  // شرط الظهور: أدمن، أو موظف ثابت (permanent) مربوط بحساب دخول
  const canShow = session?.is_admin || (session?.employee_id && myEmployee?.emp_type === 'permanent')
  if (!canShow) return null

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = conferences
    .filter((c) => c.date_from && new Date(c.date_from) >= today)
    .sort((a, b) => new Date(a.date_from) - new Date(b.date_from))[0]

  const left = upcoming ? Math.ceil((new Date(upcoming.date_from) - today) / 864e5) : null

  // تاسكاتي: لو أدمن يشوف كل التاسكات غير المكتملة، لو موظف يشوف بس المسندة له
  const myTasks = tasks.filter((x) => !x.done && (session.is_admin ? true : x.employee_id === session.employee_id))

  const toggleTask = async (id, done) => {
    await updateRow('tasks', id, { done: !done })
    setTasks(await listRows('tasks'))
  }

  return (
    <div className="upcoming-widget">
      <button className="upcoming-toggle" onClick={() => setOpen((v) => !v)}>
        📌 {t('myWidget')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="upcoming-body">
          <div className="upcoming-section">
            <b className="upcoming-label">🎪 {t('nextEvent')}</b>
            {upcoming ? (
              <div className="upcoming-event">
                <span>{upcoming.name}</span>
                <span className={`countdown-chip ${left <= 3 ? 'urgent' : ''}`}>
                  {left === 0 ? t('todayLbl') : `${left} ${t('daysLeft')}`}
                </span>
              </div>
            ) : <span className="hint-inline">{t('noUpcomingEvents')}</span>}
          </div>
          <div className="upcoming-section">
            <b className="upcoming-label">✅ {t('myTasks')} ({myTasks.length})</b>
            {myTasks.length === 0 ? (
              <span className="hint-inline">{t('noPendingTasks')}</span>
            ) : myTasks.slice(0, 6).map((x) => (
              <label className="upcoming-task" key={x.id}>
                <input type="checkbox" checked={false} onChange={() => toggleTask(x.id, x.done)} />
                {x.title || t('untitledTask')}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
