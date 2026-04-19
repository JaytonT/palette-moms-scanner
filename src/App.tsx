import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Scanner } from "@/pages/Scanner";
import { Inventory } from "@/pages/Inventory";
import { ScanBarcode, Package } from "lucide-react";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
