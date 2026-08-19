// A narrow selector over AuthContext for components that only need to know who is
// signed in, without pulling in signIn/signUp/signOut/refresh.
import { useAuth } from '../context/AuthContext';

export function useSession() {
  const { user, status } = useAuth();
  return { user, status };
}
