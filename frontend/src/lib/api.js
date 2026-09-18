// Talks to the Apps Script web app. Body is text/plain JSON so the browser sends a
// "simple" request (Apps Script cannot answer CORS preflights).
const API_URL = import.meta.env.VITE_API_URL;
const TOKEN_KEY = "gp_token";

let handlers = { authExpired: () => {}, version: () => {} };
export function setApiHandlers(h) {
  handlers = { ...handlers, ...h };
}

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// branch this phone is working at (0 = all branches, admins only); the server re-checks it
const BRANCH_KEY = "gp_branch";
export const getBranch = () => Number(localStorage.getItem(BRANCH_KEY) || 0);
export const setBranch = (id) => localStorage.setItem(BRANCH_KEY, String(id || 0));
export const clearBranch = () => localStorage.removeItem(BRANCH_KEY);

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// safe to retry: reads, plus completeSale (idempotent via client_ref)
const RETRYABLE = new Set([
  "bootstrap", "getCatalog", "dashboard", "listSales", "getSale", "report", "listCustomers", "findCustomer",
  "listHeld", "movements", "listExpenses", "listUsers", "listLogs", "customerHistory", "listSellers",
  "getSettings", "stockInBatches", "me", "completeSale", "ping",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(action, payload = {}) {
  if (!API_URL) throw new ApiError("App not configured: VITE_API_URL is missing.", "CONFIG");
  if (!navigator.onLine) throw new ApiError("You're offline. Check the internet and try again.", "OFFLINE");
  const attempts = RETRYABLE.has(action) ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, token: getToken(), branch_id: getBranch(), payload }),
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.cv) handlers.version(json.cv);
      if (!json.success) {
        if (json.code === "AUTH_EXPIRED") handlers.authExpired();
        throw new ApiError(json.message || "Request failed", json.code);
      }
      return json;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (i < attempts - 1) await sleep(700 * (i + 1));
    }
  }
  throw new ApiError("Couldn't reach the server. Check the internet and try again.", "NETWORK");
}
