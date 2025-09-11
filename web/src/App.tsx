import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import LoginPage from '@/pages/LoginPage'
import Dashboard from '@/pages/Dashboard'
import { Spin } from 'antd'

function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Routes>
      <Route 
        path="/login" 
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} 
      />
      <Route 
        path="/dashboard/*" 
        element={user ? <Dashboard /> : <Navigate to="/login" replace />} 
      />
      <Route 
        path="/" 
        element={<Navigate to="/dashboard" replace />} 
      />
    </Routes>
  )
}

export default App