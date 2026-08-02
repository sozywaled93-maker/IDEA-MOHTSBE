import { useState } from 'react'
import { useLang } from '../../lib/i18n.jsx'
import SuppliersTab from './SuppliersTab.jsx'
import ClientsTab from './ClientsTab.jsx'
import VenuesTab from './VenuesTab.jsx'

export default function ContactsPage() {
  const { t } = useLang()
  const [tab, setTab] = useState('suppliers')
  return (
    <div>
      <h1 className="page-title">{t('contacts')}</h1>
      <div className="tabs">
        <button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')}>{t('suppliers')}</button>
        <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')}>{t('clients')}</button>
        <button className={tab === 'venues' ? 'active' : ''} onClick={() => setTab('venues')}>{t('venues')}</button>
      </div>
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'clients' && <ClientsTab />}
      {tab === 'venues' && <VenuesTab />}
    </div>
  )
}
