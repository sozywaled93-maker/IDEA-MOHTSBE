import { useLang } from '../lib/i18n.jsx'

// onClose: يُستدعى فقط من زر X (الخلفية لا تُغلق المودال أبداً)
// onDirtyClose: اختياري — دالة تُستدعى بدل onClose مباشرة لو فيه تعديلات غير محفوظة، تُظهر سؤال حفظ/تجاهل
export function Modal({ title, children, onClose, wide, dirty, onSaveAndClose }) {
  const { t } = useLang()
  const handleCloseClick = () => {
    if (dirty) {
      // نعم = حفظ ثم إغلاق / لا = تجاهل وإغلاق / إلغاء = الاستمرار في التحرير
      const choice = window.confirm(t('saveChangesQ') + '\n\n' + t('okToSaveCancelToStay'))
      if (choice) { onSaveAndClose ? onSaveAndClose() : onClose() }
      else { /* المستخدم اختار "إلغاء" في نافذة confirm → البقاء بدون إغلاق */
        if (window.confirm(t('discardChangesQ'))) onClose()
      }
    } else {
      onClose()
    }
  }
  return (
    <div className="modal-back">
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={handleCloseClick}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDelete({ onConfirm, onCancel, message }) {
  const { t } = useLang()
  return (
    <Modal title={t('confirmDelete')} onClose={onCancel}>
      {message && <p className="hint-inline" style={{ color: '#A32D2D', marginBottom: 10 }}>⚠ {message}</p>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="add-btn" style={{ borderColor: '#ccc', color: '#666' }} onClick={onCancel}>{t('cancel')}</button>
        <button className="save-btn" style={{ background: '#A32D2D' }} onClick={onConfirm}>{t('delete')}</button>
      </div>
    </Modal>
  )
}

export function EmptyState() {
  const { t } = useLang()
  return <div className="placeholder">📭 {t('noData')}</div>
}
