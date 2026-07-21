import { useState } from 'react'
import Header from './components/Header'
import DataTable from './components/DataTable'

function App() {
  const [isDark, setIsDark] = useState(true)

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors duration-300">
        <Header
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
        />
        <main className="p-4 lg:p-6 max-w-7xl mx-auto">
          <DataTable />
        </main>
      </div>
    </div>
  )
}

export default App
