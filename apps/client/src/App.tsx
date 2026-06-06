import { BrowserRouter, Routes, Route } from 'react-router'
import { AuthProvider } from './components/auth/AuthProvider.js'
import { ProtectedRoute } from './components/auth/ProtectedRoute.js'
import { LandingPage } from './pages/LandingPage.js'
import { LoginPage } from './pages/LoginPage.js'
import { RegisterPage } from './pages/RegisterPage.js'
import { ResetPasswordRequestPage } from './pages/ResetPasswordRequestPage.js'
import { ResetPasswordConfirmPage } from './pages/ResetPasswordConfirmPage.js'
import { GameStubPage } from './pages/GameStubPage.js'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/reset-password" element={<ResetPasswordRequestPage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordConfirmPage />} />
          <Route
            path="/game"
            element={
              <ProtectedRoute>
                <GameStubPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
