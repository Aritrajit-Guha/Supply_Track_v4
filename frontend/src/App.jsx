import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/useAuth';
import AdminDashboard from './pages/AdminDashboard';
import ShopDashboard from './pages/ShopDashboard';
import AuthPage from './pages/AuthPage';
import TruckView from './components/TruckView';

const ProtectedRoute = ({ children }) => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/auth" />;
  return children;
};

function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />

      {/* Shop owner marketplace dashboard */}
      <Route path="/" element={
        <ProtectedRoute><ShopDashboard /></ProtectedRoute>
      } />

      {/* Shop owner cart dashboard */}
      <Route path="/cart" element={
        <ProtectedRoute><ShopDashboard /></ProtectedRoute>
      } />

      {/* Shop owner order dashboard */}
      <Route path="/orders" element={
        <ProtectedRoute><ShopDashboard /></ProtectedRoute>
      } />

      {/* Shop owner order dashboard */}
      <Route path="/invoice" element={
        <ProtectedRoute><ShopDashboard /></ProtectedRoute>
      } />

      {/* Admin / fleet view */}
      <Route path="/fleet" element={
        <ProtectedRoute><AdminDashboard /></ProtectedRoute>
      } />

      {/* Individual truck IoT view */}
      <Route path="/truck/:id" element={
        <ProtectedRoute><TruckView /></ProtectedRoute>
      } />
    </Routes>
  );
}

export default App;
