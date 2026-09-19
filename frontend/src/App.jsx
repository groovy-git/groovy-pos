import { lazy, Suspense } from "react";
import { Home as HomeIcon, ShoppingBag, Receipt, Boxes, Menu, Users, BarChart3, Wallet, Settings as Cog, LogOut, UserCircle, History, Package } from "lucide-react";
import { useApp } from "./store";
import { useRoute, navigate } from "./lib/router";
import { Toasts, Spinner } from "./components/ui";
import BusyOverlay from "./components/BusyOverlay";
import { BranchChip, BranchPicker } from "./components/Branch";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Sell from "./pages/Sell";

const Sales = lazy(() => import("./pages/Sales"));
const SaleDetail = lazy(() => import("./pages/SaleDetail"));
const Stock = lazy(() => import("./pages/Stock"));
const ProductForm = lazy(() => import("./pages/ProductForm"));
const StockIn = lazy(() => import("./pages/StockIn"));
const Transfer = lazy(() => import("./pages/Transfer"));
const Customers = lazy(() => import("./pages/Customers"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Reports = lazy(() => import("./pages/Reports"));
const More = lazy(() => import("./pages/More"));
const UsersPage = lazy(() => import("./pages/Users"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Logs = lazy(() => import("./pages/Logs"));
const Account = lazy(() => import("./pages/Account"));

// who may open which page (server enforces the same rules on every action)
const ACCESS = {
  home: "all", sell: "all", sales: "all", customers: "all", more: "all", account: "all", reports: "all", stock: "all",
  expenses: "mgr", users: "admin", settings: "admin", logs: "admin",
};

function Page({ route }) {
  const { page, parts } = route;
  switch (page) {
    case "home": return <Home />;
    case "sell": return <Sell />;
    case "sales": return parts[1] ? <SaleDetail id={Number(parts[1])} /> : <Sales />;
    case "stock":
      if (parts[1] === "product") return <ProductForm id={parts[2] === "new" ? null : Number(parts[2])} />;
      if (parts[1] === "in") return <StockIn />;
      if (parts[1] === "transfer") return <Transfer />;
      return <Stock tab={parts[1]} />;
    case "customers": return <Customers />;
    case "expenses": return <Expenses />;
    case "reports": return <Reports />;
    case "more": return <More />;
    case "users": return <UsersPage />;
    case "settings": return <SettingsPage />;
    case "logs": return <Logs />;
    case "account": return <Account />;
    default: return <Home />;
  }
}

export default function App() {
  const { user, booting, rawCatalog, online, isManager, isAdmin, logout, settings, branchId } = useApp();
  const route = useRoute();

  if (!user) return (<><Login /><Toasts /><BusyOverlay /></>);
  if (booting && !rawCatalog)
    return (
      <div className="login">
        <img className="logo" src="./logo.svg" alt="Groovy Fragrances" />
        <div className="tagline">Loading your shop…</div>
        <Spinner />
      </div>
    );

  const allowed = (p) => {
    const a = ACCESS[p] || "all";
    return a === "all" || (a === "mgr" && isManager) || (a === "admin" && isAdmin);
  };
  const page = allowed(route.page) ? route.page : "home";
  const active = ["users", "settings", "logs", "account", "customers", "expenses", "reports"].includes(page) ? "more" : page;

  const tabs = isManager
    ? [
        { id: "home", label: "Home", icon: HomeIcon },
        { id: "stock", label: "Stock", icon: Boxes },
        { id: "sell", label: "Sell", icon: ShoppingBag, center: true },
        { id: "sales", label: "Sales", icon: Receipt },
        { id: "more", label: "More", icon: Menu },
      ]
    : [
        { id: "home", label: "Home", icon: HomeIcon },
        { id: "sales", label: "My Sales", icon: Receipt },
        { id: "sell", label: "Sell", icon: ShoppingBag, center: true },
        { id: "stock", label: "Products", icon: Package },
        { id: "more", label: "More", icon: Menu },
      ];

  const side = [
    { id: "home", label: "Home", icon: HomeIcon },
    { id: "sell", label: "Sell", icon: ShoppingBag },
    { id: "sales", label: isManager ? "Sales" : "My Sales", icon: Receipt },
    { id: "stock", label: isManager ? "Stock" : "Products", icon: Boxes },
    { id: "customers", label: "Customers", icon: Users },
    isManager && { id: "expenses", label: "Expenses", icon: Wallet },
    { id: "reports", label: "Reports", icon: BarChart3 },
    isAdmin && { id: "users", label: "Staff", icon: UserCircle },
    isAdmin && { id: "settings", label: "Settings", icon: Cog },
    isAdmin && { id: "logs", label: "Activity", icon: History },
  ].filter(Boolean);

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <img src="./logo.svg" alt="" />
          <div>
            <div className="name">{settings.business_name || "Groovy Fragrances"}</div>
            <div className="tag">{(settings.tagline || "Smell of perfection").toUpperCase()}</div>
          </div>
        </div>
        <BranchChip />
        {side.map((s) => (
          <button key={s.id} className={page === s.id ? "active" : ""} onClick={() => navigate(s.id)}>
            <s.icon size={20} /> {s.label}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={() => navigate("account")} className={page === "account" ? "active" : ""}>
          <UserCircle size={20} /> {user.name}
        </button>
        <button onClick={logout}>
          <LogOut size={20} /> Log out
        </button>
      </nav>

      <div className="main">
        {!online && <div className="offline">You're offline — you can browse, but bills can't be saved until you're back online.</div>}
        <Suspense
          fallback={
            <div className="page">
              <div className="skeleton" style={{ height: 120 }} />
            </div>
          }
        >
          {/* switching branch reloads the open screen with that branch's data */}
          <Page key={branchId} route={{ ...route, page }} />
        </Suspense>
      </div>

      <nav className="bottomnav" aria-label="Main">
        {tabs.map((t) =>
          t.center ? (
            <button key={t.id} className={"sell-tab" + (active === t.id ? " active" : "")} onClick={() => navigate(t.id)} aria-label="Sell">
              <span className="sell-circle">
                <t.icon size={26} />
              </span>
              {t.label}
            </button>
          ) : (
            <button key={t.id} className={active === t.id ? "active" : ""} onClick={() => navigate(t.id)}>
              <t.icon size={23} />
              {t.label}
            </button>
          ),
        )}
      </nav>
      <BranchPicker />
      <Toasts />
      <BusyOverlay />
    </div>
  );
}
