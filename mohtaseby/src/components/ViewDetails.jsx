import { Modal } from './ui.jsx'

// عرض تفاصيل سريع للقراءة فقط: قائمة { label, value } تُعرض بشكل منظم
export default function ViewDetails({ title, rows, onClose, extra }) {
  return (
    <Modal title={`👁 ${title}`} onClose={onClose}>
      <div className="view-details">
        {rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== '').map((r, i) => (
          <div className="view-row" key={i}>
            <span className="view-label">{r.label}</span>
            <span className="view-value" dir={r.ltr ? 'ltr' : undefined}>{r.value}</span>
          </div>
        ))}
      </div>
      {extra}
    </Modal>
  )
}
