import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Scanner } from "@/pages/Scanner";
import { Inventory } from "@/pages/Inventory";
import { AuthGate } from "@/components/AuthGate";
import { supabase, authConfigured } from "@/lib/supabase";
import { ScanBarcode, Package, LogOut } from "lucide-react";

const queryClient = new QueryClient();

function SignOut() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!authConfigured) return;
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);
  if (!authConfigured) return null;
  return (
    <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
      {email && <span className="hidden sm:inline">{email}</span>}
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        className="flex items-center gap-1.5 hover:text-foreground"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
      <BrowserRouter>
        <div className="min-h-screen bg-background">
          <nav className="border-b bg-card px-4 py-3 flex items-center gap-6">
            <span className="font-bold text-primary">Palette Moms</span>
            <NavLink
              to="/"
              className={({ isActive }) =>
                `flex items-center gap-1.5 text-sm ${
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <ScanBarcode className="h-4 w-4" />
              Scanner
            </NavLink>
            <NavLink
              to="/inventory"
              className={({ isActive }) =>
                `flex items-center gap-1.5 text-sm ${
                  isActive
                    ? "text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              <Package className="h-4 w-4" />
              Inventory
            </NavLink>
            <SignOut />
          </nav>
          <main className="max-w-3xl mx-auto">
            <Routes>
              <Route path="/" element={<Scanner />} />
              <Route path="/inventory" element={<Inventory />} />
            </Routes>
          </main>
        </div>
        <Toaster richColors />
      </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  );
}
