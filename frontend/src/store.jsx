import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, clearBranch, clearToken, getBranch, getToken, setApiHandlers, setBranch, setToken } from "./lib/api";
import { navigate } from "./lib/router";
import { buildCatalog } from "./lib/catalog";
import { runBusy } from "./lib/busy";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const load = (k, def) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full / private mode — app still works */
  }
};

const EMPTY_CART = { lines: [], bill_disc: 0, customer: { phone: "", name: "", gstin: "" }, salesman_id: null, notes: "", held_id: null, gst_hidden: false };
// a bill in progress belongs to the branch it was started at
const cartKey = (branchId) => "gp_cart_" + (branchId || 0);
const pickedKey = (userId) => "gp_branch_picked_" + userId;

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? load("gp_user", null) : null));
  const [settings, setSettings] = useState(() => load("gp_settings", {}));
  const [rawCatalog, setRawCatalog] = useState(() => load("gp_catalog", null));
  const [sellers, setSellers] = useState(() => load("gp_sellers", []));
  const [branches, setBranches] = useState(() => load("gp_branches", []));
  const [branchId, setBranchId] = useState(getBranch);
  const [pickBranch, setPickBranch] = useState(false);
  const [booting, setBooting] = useState(!!getToken());
  const [online, setOnline] = useState(navigator.onLine);
  const [cart, setCartState] = useState(() => load(cartKey(getBranch()), load("gp_cart", EMPTY_CART)));
  const [toasts, setToasts] = useState([]);
  const versionRef = useRef(rawCatalog ? rawCatalog.version : 0);
  const branchRef = useRef(branchId);
  const refreshing = useRef(false);

  const toast = useCallback((message, type = "info", ms = 2600) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const setCart = useCallback((updater) => {
    setCartState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      save(cartKey(branchRef.current), next);
      return next;
    });
  }, []);
  const clearCart = useCallback(() => setCart(EMPTY_CART), [setCart]);

  const applyCatalog = useCallback((c) => {
    versionRef.current = c.version;
    setRawCatalog(c);
    save("gp_catalog", c);
  }, []);

  // switch the phone to a branch: its own stock (next bootstrap) and its own bill in progress
  const applyBranch = useCallback((id) => {
    const b = Number(id) || 0;
    setBranch(b);
    if (branchRef.current !== b) {
      branchRef.current = b;
      setCartState(load(cartKey(b), EMPTY_CART));
    }
    setBranchId(b);
  }, []);

  const refreshCatalog = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const r = await api("getCatalog");
      applyCatalog(r.data);
    } catch {
      /* keep cached catalog */
    } finally {
      refreshing.current = false;
    }
  }, [applyCatalog]);

  const logoutLocal = useCallback(() => {
    clearToken();
    clearBranch(); // the next person on this phone starts at their own home branch
    // shared phones: the next person must not see this person's data (costs, carts, figures, emails)
    Object.keys(localStorage)
      .filter((k) => /^gp_(user|sellers|catalog|settings|branches|cart)/.test(k))
      .forEach((k) => localStorage.removeItem(k));
    try {
      sessionStorage.clear(); // dashboard cache, drafts, filters
    } catch {
      /* private mode */
    }
    setRawCatalog(null);
    setSettings({});
    setUser(null);
    branchRef.current = 0;
    setBranchId(0);
    setCartState(EMPTY_CART);
    navigate("home", { replace: true }); // the next person starts at Home, not the last screen used
  }, []);

  useEffect(() => {
    setApiHandlers({
      authExpired: () => {
        logoutLocal();
        toast("Please log in again", "warn");
      },
      version: (cv) => {
        if (cv > versionRef.current) refreshCatalog();
      },
    });
  }, [logoutLocal, refreshCatalog, toast]);

  const bootstrap = useCallback(async () => {
    let r;
    try {
      r = await api("bootstrap");
    } catch (e) {
      if (e.code !== "BRANCH") throw e;
      clearBranch(); // remembered branch no longer allowed → server picks the home branch
      r = await api("bootstrap");
    }
    const d = r.data;
    setUser(d.user);
    setSettings(d.settings);
    setSellers(d.sellers);
    setBranches(d.branches);
    applyCatalog(d.catalog);
    applyBranch(d.branch_id);
    save("gp_user", d.user);
    save("gp_settings", d.settings);
    save("gp_sellers", d.sellers);
    save("gp_branches", d.branches);
    // first time on this phone with a choice of branches → ask where they're working
    const choices = d.user.role === "admin" ? d.branches.length : d.user.branch_ids.length;
    if (choices > 1 && !localStorage.getItem(pickedKey(d.user.id))) setPickBranch(true);
    return d;
  }, [applyCatalog, applyBranch]);

  // on app open: refresh everything in the background (cached data shows instantly)
  useEffect(() => {
    if (!getToken()) return;
    bootstrap()
      .catch((e) => {
        if (e.code !== "AUTH_EXPIRED") toast(e.message, "error");
      })
      .finally(() => setBooting(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const login = useCallback(
    async (email, password) => {
      const r = await api("login", { email, password, device: navigator.userAgent.slice(0, 100) });
      setToken(r.data.token);
      setBooting(true); // "Loading your shop…" until products and settings arrive
      setUser(r.data.user);
      save("gp_user", r.data.user);
      try {
        await bootstrap();
      } finally {
        setBooting(false);
      }
    },
    [bootstrap],
  );

  // the screen is blocked until the phone is fully logged out
  const logout = useCallback(
    () =>
      runBusy("Logging out…", async () => {
        try {
          await api("logout");
        } catch {
          /* already logged out server-side */
        }
        logoutLocal();
      }),
    [logoutLocal],
  );

  const switchBranch = useCallback(
    // the screen is blocked until the new branch's stock and settings have loaded
    (id) => {
      const target = branches.find((x) => x.id === Number(id));
      return runBusy(target ? `Switching to ${target.name}…` : "Loading all branches…", async () => {
        const prev = branchRef.current;
        applyBranch(id);
        if (user) localStorage.setItem(pickedKey(user.id), "1");
        setPickBranch(false);
        try {
          const d = await bootstrap();
          const b = d.branches.find((x) => x.id === d.branch_id);
          toast(b ? `Now working at ${b.name}` : "Showing all branches", "success", 2000);
        } catch (e) {
          applyBranch(prev);
          toast(e.message, "error");
        }
      });
    },
    [applyBranch, bootstrap, toast, user, branches],
  );

  const catalog = useMemo(() => buildCatalog(rawCatalog), [rawCatalog]);

  // patch stock locally after a sale / stock-in so the UI is instant; server version refresh follows
  const patchStock = useCallback((changes) => {
    setRawCatalog((c) => {
      if (!c) return c;
      const m = new Map(changes.map((x) => [x.id, x.stock_qty]));
      const next = { ...c, variants: c.variants.map((v) => (m.has(v.id) ? { ...v, stock_qty: m.get(v.id) } : v)) };
      save("gp_catalog", next);
      return next;
    });
  }, []);

  const role = user ? user.role : null;
  const multiBranch = branches.length > 1;
  const branch = branches.find((b) => b.id === branchId) || null;
  // branches this person can switch to (admins: all)
  const myBranches = !user ? [] : role === "admin" ? branches : branches.filter((b) => (user.branch_ids || []).includes(b.id));

  const value = {
    user, role, isManager: role === "admin" || role === "manager", isAdmin: role === "admin",
    settings, setSettings: (s) => { setSettings(s); save("gp_settings", s); },
    catalog, rawCatalog, refreshCatalog, patchStock,
    sellers, setSellers,
    branches, branchId, branch, multiBranch, myBranches, isAllBranches: multiBranch && !branchId,
    switchBranch, pickBranch, setPickBranch,
    booting, online,
    login, logout, bootstrap,
    cart, setCart, clearCart,
    toast, toasts,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
