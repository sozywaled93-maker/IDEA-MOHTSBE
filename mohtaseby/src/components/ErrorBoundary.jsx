import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('App crashed:', error, info) }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 14, padding: 24, fontFamily: 'IBM Plex Sans Arabic, sans-serif',
          textAlign: 'center', direction: 'rtl',
        }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ margin: 0 }}>حدث خطأ غير متوقع في هذه الصفحة</h2>
          <p style={{ color: '#7A736C', maxWidth: 480, fontSize: 13.5, direction: 'ltr', textAlign: 'left', background: '#F4F1EC', padding: 12, borderRadius: 8 }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            style={{ background: '#E96324', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
