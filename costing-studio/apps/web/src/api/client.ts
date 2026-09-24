import axios from "axios";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "" });

api.interceptors.request.use((cfg) => {
  let t: string | null = null;
  try { t = localStorage.getItem("token"); } catch { /* ignore */ }
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

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
