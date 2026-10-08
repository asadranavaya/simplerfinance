import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// The home route is kept for any deep-linked / legacy redirects.
// Auth is handled by AuthContext — once logged in the user goes straight to overview.
export default function Home() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/overview', { replace: true }); }, [navigate]);
  return null;
}
