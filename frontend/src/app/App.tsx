// phase_1 §3 — ThemeProvider is mounted at the root, above the router. AuthProvider
// mounts here too (above RouterProvider) because /login needs it just as much as the
// authenticated shell does.
import { ThemeProvider } from 'next-themes';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import { router } from './routes';

export default function App() {
  return (
    <ThemeProvider
      attribute="class"          // toggles class="dark" on <html> — matches theme.css's
                                  //   @custom-variant dark (&:is(.dark *))
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange  // suppresses the 200ms color transition DURING the
                                  //   swap, otherwise every element animates at once and
                                  //   the switch reads as a 200ms smear
      storageKey="cerebro-theme"
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}
