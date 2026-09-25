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
export interface GuardOut { accepted: boolean; reason: string; final_value: string }
export interface SHAPFeature { feature: string; contribution: number }

export type Position = "attractive" | "too_high" | "too_low" | "not_viable";

export interface ProductRow {
  id: string; name: string; category: string; base_unit: string; attributes: Record<string, unknown>;
  computed_at: string | null; currency: string | null; floor_minor: number | null; target_minor: number | null;
  ceiling_minor: number | null; market_reference_minor: number | null; position: Position | null;
}
export interface CostElementRow {
  id: string; name: string; unit: string; rate_minor: number; currency: string;
  valid_from: string; valid_to: string | null; qty_per_unit: number | null; current: boolean;
}
export interface MarginRow {
  id: string; min_pct: number; target_pct: number; max_pct: number | null;
  valid_from: string; valid_to: string | null; current: boolean;
}
export interface MarketSourceRow {
  id: string; source: string; url: string | null; parser: string | null; frequency: string;
  staleness_days: number; active: boolean;
}
export interface MarketPriceRow { source: string; price_minor: number; currency: string; unit: string; observed_at: string }
export interface ProductDetail {
  id: string; name: string; category: string; base_unit: string; attributes: Record<string, unknown>;
  cost_elements: CostElementRow[]; margin_configs: MarginRow[];
  market_sources: MarketSourceRow[]; market_prices: MarketPriceRow[];
}
export interface MarketComparison {
  position: Position; market_reference_minor: number; gap_to_floor: number; gap_to_target: number;
  gap_to_ceiling: number; sources_used: string[];
}
export interface Envelope {
  product_id: string; snapshot_id: string; computed_at: string; as_of: string; computed_by?: string;
  currency: string; unit: string; unit_cost_minor: number; floor_minor: number; target_minor: number;
  ceiling_minor: number; ceiling_source: "max_pct" | "mirror";
  lines: { name: string; amount_minor: number }[];
  market: MarketComparison | null; explanation: string;
}
export interface Forecast {
  available: boolean; reason?: string | null; product_id: string; as_of: string; target: string;
  model_version?: string | null; target_currency?: string | null; target_unit?: string | null;
  p10?: string | null; p50?: string | null; p90?: string | null; shap_top5: SHAPFeature[];
}

export const listProducts = () => api.get<{ items: ProductRow[] }>("/api/v1/products").then((r) => r.data.items);
export const getProduct = (id: string) => api.get<ProductDetail>(`/api/v1/products/${id}`).then((r) => r.data);
export const createProduct = (body: { name: string; category: string; base_unit: string; attributes?: object }) =>
  api.post<{ id: string }>("/api/v1/products", body).then((r) => r.data);
export const patchProduct = (id: string, body: Record<string, unknown>) =>
  api.patch(`/api/v1/products/${id}`, body).then((r) => r.data);
export const addCostElement = (id: string, body: Record<string, unknown>) =>
  api.post(`/api/v1/products/${id}/cost-elements`, body).then((r) => r.data);
export const setMarginConfig = (id: string, body: Record<string, unknown>) =>
  api.post(`/api/v1/products/${id}/margin-config`, body).then((r) => r.data);
export const computeEnvelope = (product_id: string) =>
  api.post<Envelope>("/api/v1/envelope", { product_id }).then((r) => r.data);
export const latestEnvelope = (product_id: string) =>
  api.get<Envelope>(`/api/v1/envelope/${product_id}`).then((r) => r.data)
    .catch((e) => { if (e?.response?.status === 404) return null; throw e; });
export const ingestMarketCsv = (product_id: string, source: string, file: File) => {
  const fd = new FormData();
  fd.append("product_id", product_id); fd.append("source", source); fd.append("file", file);
  return api.post<{ rows: number; received: number }>("/api/v1/market-prices/ingest-csv", fd).then((r) => r.data);
};
export const getForecast = (product_id: string) =>
  api.get<Forecast>("/api/v1/predict", { params: { product_id } }).then((r) => r.data);
export const errText = (e: unknown) => {
  const d = (e as any)?.response?.data?.detail;
  return typeof d === "string" ? d : d ? JSON.stringify(d) : String(e);
};

export type Verdict = "sellable_comfortable" | "sellable_marginal" | "not_sellable";
export interface SimChannel {
  channel: string; channel_type: "trade" | "retail" | "export" | "import"; market_ref_minor: number;
  headroom_pct: number; position: Position; verdict: Verdict; excluded: boolean;
}
export interface SimResult {
  product_id: string; product_name: string; as_of: string; currency: string; unit: string;
  inputs: { skipjack_usd: string | null; margin_floor_pct: string; margin_target_pct: string;
            margin_max_pct: string | null; exclude_channels: string[]; exclusion: "default_by_type" | "caller" };
  envelope: { unit_cost_minor: number; floor_minor: number; target_minor: number; ceiling_minor: number;
              ceiling_source: "max_pct" | "mirror"; lines: { name: string; amount_minor: number }[] };
  last_viable_sell_minor: number; channels: SimChannel[]; recommendation: string | null;
}
export interface SimRequest {
  product_id: string; skipjack_usd: string | null; margin_floor_pct: string; margin_target_pct: string;
  as_of: string; exclude_channels?: string[];     // omit -> server excludes retail + import channels
}
/** Read-only what-if: nothing is stored server-side. */
export const simulate = (req: SimRequest) => api.post<SimResult>("/api/v1/simulate", req).then((r) => r.data);
