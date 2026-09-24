import axios from "axios";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "" });

api.interceptors.request.use((cfg) => {
  let t: string | null = null;
  try { t = localStorage.getItem("token"); } catch { /* ignore */ }
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// An expired or invalid token sends the user back to the login page.
api.interceptors.response.use(undefined, (err) => {
  const onLogin = window.location.pathname.startsWith("/login");
  if (err?.response?.status === 401 && !String(err.config?.url ?? "").includes("/auth/login") && !onLogin) {
    clearSession();
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  return Promise.reject(err);
});

export interface User { id: string; tenant_id: string; email: string; role: string; locale: string }

export function clearSession() {
  try { localStorage.removeItem("token"); localStorage.removeItem("user"); } catch { /* ignore */ }
}
export function currentUser(): User | null {
  try {
    if (!localStorage.getItem("token")) return null;
    return JSON.parse(localStorage.getItem("user") ?? "null");
  } catch { return null; }
}
export const login = async (email: string, password: string): Promise<User> => {
  const d = (await api.post<{ access_token: string; user: User }>("/api/v1/auth/login", { email, password })).data;
  try { localStorage.setItem("token", d.access_token); localStorage.setItem("user", JSON.stringify(d.user)); }
  catch { /* storage unavailable: session lasts for this page only */ }
  return d.user;
};

export type LineSource = "formula" | "manual" | "ml" | "ml_derived";
export interface Money { amount_minor: number; amount_major: string; currency: string }
export interface CostLine extends Money { type: string; source: LineSource; note?: string }
export interface GuardOut { accepted: boolean; reason: string; final_value: string }
export interface MLInput { field: string; predicted_value: string; guard: GuardOut }
export interface SHAPFeature { feature: string; contribution: number }
export interface QuoteVsForecast {
  quote_price: string; forecast_p50: string; pct_deviation: string; within_p10_p90: boolean;
  flag: "ok" | "outside_range"; compare_currency: string; compare_unit: string;
}
export interface Quote {
  lines: CostLine[]; landed_cost: Money; sellable_qty: string;
  landed_cost_per_sellable_unit: Money; break_even_per_sellable_unit: Money;
  sell_above_threshold: Money; buy_below_threshold?: Money | null;
  ml_inputs: MLInput[]; ml_fields: string[]; shap_top5: SHAPFeature[];
  quote_vs_forecast?: QuoteVsForecast | null; ml_skipped_reason?: string | null;
  explanation: string; locale: "en" | "ar";
}

export const postQuote = (req: unknown) => api.post<Quote>("/api/v1/quote", req).then((r) => r.data);

export interface DealRow {
  id: string; deal_ref: string; deal_date: string; quantity: string; base_unit: string; incoterm: string;
  currency: string; origin_country: string; dest_country: string; actual_landed_cost_minor: number | null;
  actual_sell_price_minor: number | null; base_currency: string; is_golden: boolean; status: string;
  sku: string; name_en: string; name_ar: string;
}
export interface DealLine { type: string; amount_minor: number; currency: string; source: LineSource; note?: string | null }
export interface Prediction {
  model_name: string; model_version: string; target: string; value_minor: number;
  p10_minor: number | null; p90_minor: number | null; created_at: string;
}
export interface DealDetail extends DealRow { hs_code: string; lines: DealLine[]; predictions: Prediction[] }
export interface ThresholdPoint { purchase_unit_price_major: string; landed_per_sellable_minor: number }
export interface DealThresholds {
  currency: string; base_currency: string; purchase_unit_price_major: string;
  landed_per_sellable: Money; break_even_per_sellable: Money; sell_above_threshold: Money;
  actual_sell_per_sellable?: Money | null; target_margin: string; buy_below_threshold?: Money | null;
  curve: ThresholdPoint[];
}

export const listDeals = (params: { q?: string; golden?: boolean }) =>
  api.get<{ items: DealRow[] }>("/api/v1/deals", { params }).then((r) => r.data.items);
export const getDeal = (id: string) => api.get<DealDetail>(`/api/v1/deals/${id}`).then((r) => r.data);
export const getThresholds = (id: string, target_margin: string) =>
  api.get<DealThresholds>(`/api/v1/deals/${id}/thresholds`, { params: { target_margin } }).then((r) => r.data);
