// تنقل خفيف بين الصفحات مع تمرير معاملات (الصفحة الحالية بتتحكم فيها App.jsx بـ useState بسيط،
// فمفيش React Router — الحل ده بيبعت event تسمعه App.jsx وبيحط المعاملات في مكان تقدر أي صفحة تقرأه لما تفتح)

export function goto(page, params = {}) {
  window.__navParams = params
  window.dispatchEvent(new CustomEvent('app-goto', { detail: { page, params } }))
}

// تُستخدم جوه أي صفحة هدف: بترجع المعاملات اللي اتبعتت ليها (لو موجودة) وبتمسحها بعد القراءة
// عشان لو المستخدم رجع للصفحة تاني عادي من غير تنقل، ما يفضلش الفلتر شغال قسرًا
export function consumeNavParams() {
  const p = window.__navParams
  window.__navParams = null
  return p || null
}
