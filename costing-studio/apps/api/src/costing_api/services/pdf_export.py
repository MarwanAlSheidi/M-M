"""One-page A4 PDF of a simulation (POST /api/v1/simulate/export.pdf), rendered with WeasyPrint.

Presentation only: every number comes from routers.simulate.run_simulation. Fonts are the Noto files
bundled in costing_api/assets/fonts (OFL) and referenced by absolute file:// URIs, so the output does not
depend on the fonts installed on the machine.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date
from html import escape
from pathlib import Path

from costing.currencies import exponent_of

FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"

VERDICT = {"sellable_comfortable": ("Comfortable", "مريح"), "sellable_marginal": ("Marginal", "هامشي"),
           "not_sellable": ("Not sellable", "غير قابل للبيع")}
CHANNEL_TYPE = {"trade": "تجارة", "retail": "تجزئة", "export": "تصدير", "import": "استيراد"}

CSS = """
@font-face { font-family: 'Noto Sans'; src: url('%(sans)s'); }
@font-face { font-family: 'Noto Sans'; font-weight: bold; src: url('%(sans_bold)s'); }
@font-face { font-family: 'Noto Naskh Arabic'; src: url('%(naskh)s'); }
@page { size: A4; margin: 15mm; }
html { font-family: 'Noto Sans'; font-size: 10pt; line-height: 1.25; color: #111; }
table.sens td { padding-top: 0.3mm; padding-bottom: 0.3mm; }
html[lang="ar"], .ar { font-family: 'Noto Naskh Arabic'; direction: rtl; text-align: right; }
.ltr { direction: ltr; unicode-bidi: embed; }
h1 { font-size: 15pt; margin: 0; font-weight: normal; }
h1.ar { font-size: 17pt; }
h2 { font-size: 11pt; margin: 3.5mm 0 1mm; font-weight: bold; }
h2 .ar { font-weight: normal; margin-left: 2mm; }
.meta { margin-top: 1mm; color: #444; }
.warn { margin-top: 2.5mm; padding: 1.5mm 3mm; border: 0.6pt solid #b45309; background: #fffbeb; color: #78350f; }
.warn .ar { margin-top: 0.5mm; }
table { width: 100%%; border-collapse: collapse; page-break-inside: avoid; break-inside: avoid; }
th, td { padding: 0.6mm 2mm; border-bottom: 0.4pt solid #ccc; text-align: left; vertical-align: top; }
th { font-weight: normal; color: #555; border-bottom: 0.8pt solid #888; }
th .ar, h2 .ar, .sub .ar { color: #555; }
th .ar { display: block; font-size: 8.5pt; }
.bi .ar { margin-left: 1.5mm; }
td.nw { white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.excluded td { color: #9ca3af; }
tr.recommended td { font-weight: bold; }
.note { color: #555; font-size: 8.5pt; }
.sub { color: #555; font-size: 8.5pt; font-weight: normal; }
td .sub.block { display: block; white-space: nowrap; }
footer { margin-top: 4mm; padding-top: 2mm; border-top: 0.6pt solid #888; color: #444; font-size: 8.5pt; }
footer p { margin: 0.8mm 0; }
"""


def _money(minor: int, currency: str) -> str:
    exp = exponent_of(currency)
    return f"{minor / 10 ** exp:,.{exp}f}"


def _pct(v) -> str:
    return "—" if v is None else f"{v:+.1f}%"


def _ar(text: str, tag: str = "span") -> str:
    return f'<{tag} class="ar" lang="ar">{escape(text)}</{tag}>'


def _th(en: str, ar: str) -> str:
    return f"{escape(en)}{_ar(ar)}"


def _bi(en: str, ar: str) -> str:
    return f'<span class="bi">{escape(en)} /{_ar(ar)}</span>'


def _note(cls: str) -> str:
    if cls == "excluded":
        return f"<span class='sub bi block'>excluded /{_ar('مستبعدة')}</span>"
    return f"<span class='sub bi block'>recommended /{_ar('موصى بها')}</span>" if cls == "recommended" else ""


def build_html(result: dict, market, sensitivity, sensitivity_channels, name_ar: str | None,
               generated: date) -> str:
    cur, unit = result["currency"], result["unit"]
    env = result["envelope"]
    per = f"{cur} / {unit}"
    rows_env = "".join(
        f"<tr><td>{_bi(en, ar)}{sub}</td><td class='num'>{_money(env[key], cur)}</td></tr>"
        for en, ar, key, sub in (
            ("Unit cost", "تكلفة الوحدة", "unit_cost_minor", ""),
            ("Floor", "الحد الأدنى", "floor_minor",
             "<span class='sub bi block'>Minimum viable sell price /" + _ar("أدنى سعر بيع مجدٍ") + "</span>"),
            ("Target", "المستهدف", "target_minor", ""),
            ("Ceiling", "السقف", "ceiling_minor", "")))

    rows_ch = []
    for c in result["channels"]:
        cls = "excluded" if c["excluded"] else ("recommended" if c["channel"] == result["recommendation"] else "")
        v_en, v_ar = VERDICT[c["verdict"]]
        rows_ch.append(
            f"<tr class='{cls}'><td>{escape(c['channel'])}{_note(cls)}</td>"
            f"<td class='nw'>{_bi(c['channel_type'], CHANNEL_TYPE.get(c['channel_type'], c['channel_type']))}</td>"
            f"<td class='num'>{_money(c['market_ref_minor'], cur)}</td>"
            f"<td class='num'>{_pct(c['headroom_pct'])}</td><td class='nw'>{_bi(v_en, v_ar)}</td></tr>")
    rec = result["recommendation"]

    if sensitivity is None:
        sens = "<p class='note'>No skipjack cost element on this product; sensitivity not applicable.</p>"
    else:
        head = "".join(f"<th class='num'>{escape(ch)} headroom</th>" for ch in sensitivity_channels)
        body = "".join(f"<tr><td class='num'>{usd:.2f}</td>" + "".join(f"<td class='num'>{_pct(h)}</td>" for h in hs)
                       + "</tr>" for usd, hs in sensitivity)
        sens = (f"<table class='sens'><thead><tr><th class='num'>Skipjack (USD/kg)</th>{head}</tr></thead>"
                f"<tbody>{body}</tbody></table>"
                f"<p class='note'>Same margins, date and channel exclusions as above; only the skipjack price "
                f"changes. Headroom = (market ref − floor) / floor.</p>")

    by_source = defaultdict(list)
    for p in market:
        by_source[p.source].append(p.observed_at)
    types = {c["channel"]: c["channel_type"] for c in result["channels"]}
    sources = "; ".join(f"{escape(s)} ({escape(types.get(s, 'trade'))}, {len(d)} price(s), latest {max(d)})"
                        for s, d in sorted(by_source.items())) or "no fresh market prices"
    inputs = result["inputs"]
    skipjack = f"skipjack {inputs['skipjack_usd']} USD/kg · " if inputs["skipjack_usd"] else ""

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{escape(result['product_name'])}</title>
<style>{CSS % {"sans": (FONTS / "NotoSans-Regular.ttf").as_uri(),
               "sans_bold": (FONTS / "NotoSans-Bold.ttf").as_uri(),
               "naskh": (FONTS / "NotoNaskhArabic-Regular.ttf").as_uri()}}</style></head>
<body>
<header>
  {_ar(name_ar, "h1") if name_ar else ""}
  <h1>{escape(result['product_name'])}</h1>
  <div class="meta bi">As of /{_ar("بتاريخ")} <span class="ltr">{result['as_of']}</span> ·
    {skipjack}margins floor {inputs['margin_floor_pct']}% · target {inputs['margin_target_pct']}%
    {f"· max {float(inputs['margin_max_pct']):.0f}%" if inputs['margin_max_pct'] else ""}</div>
  <div class="warn">Prices are benchmarks, not verified purchases.
    {_ar("الأسعار مرجعية وليست مشتريات موثّقة.", "div")}</div>
</header>

<h2 class="bi">Envelope ({per}) /{_ar("نطاق السعر")}</h2>
<table><thead><tr><th></th><th class="num">{per}</th></tr></thead><tbody>{rows_env}</tbody></table>

<h2 class="bi">Channels /{_ar("القنوات")}</h2>
<table><thead><tr><th>{_th("Channel", "القناة")}</th><th>{_th("Type", "النوع")}</th>
  <th class="num">{_th(f"Market ref ({per})", "سعر السوق")}</th><th class="num">{_th("Headroom", "الهامش فوق الحد الأدنى")}</th>
  <th>{_th("Verdict", "الحكم")}</th></tr></thead><tbody>{"".join(rows_ch)}</tbody></table>
<p class="note bi">Recommended channel /{_ar("القناة الموصى بها")}: <b>{escape(rec) if rec else "none"}</b>
  — highest headroom among included channels with a comfortable verdict (at least 10%).</p>

<h2 class="bi">Sensitivity to skipjack price /{_ar("الحساسية لسعر التونة")}</h2>
{sens}

<footer>
  <p class="bi">Generated <span class="ltr">{generated}</span> /{_ar("تم الإنشاء")} <span class="ltr">{generated}</span></p>
  <p>Sources: {sources}. Cost elements and margins: product configuration valid on {result['as_of']}.</p>
  <p>See FINDINGS.md / DECISION_BRIEF.md in the repository.</p>
</footer>
</body></html>"""


def render_simulation_pdf(result: dict, market, sensitivity, sensitivity_channels, name_ar: str | None,
                          generated: date | None = None) -> bytes:
    from weasyprint import HTML      # imported here so the rest of the API loads without the system libraries
    html = build_html(result, market, sensitivity, sensitivity_channels, name_ar, generated or date.today())
    # PDF 1.4: no compressed object streams, so the title and font dictionaries stay readable in the bytes
    return HTML(string=html, base_url=str(FONTS)).write_pdf(pdf_version="1.4")
