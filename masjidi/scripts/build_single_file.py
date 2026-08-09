#!/usr/bin/env python3
"""دمج ملفات Cloud Code في ملف main.js واحد صالح للصق في لوحة Back4app."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORDER = [
    ("lib/errors.js", "الأخطاء الموحّدة"),
    ("lib/auth.js", "الصلاحيات والأدوار"),
    ("lib/push.js", "الإشعارات"),
    ("lib/payments.js", "بوابة الدفع"),
    ("lib/audit.js", "سجل التدقيق"),
    ("lib/geo.js", "القرب الجغرافي"),
    ("lib/arabic.js", "تطبيع النصّ العربي"),
    ("triggers.js", "المُشغّلات (beforeSave / afterSave)"),
    ("functions/mosques.js", "دوال المساجد"),
    ("functions/requests.js", "دوال طلبات الصيانة"),
    ("functions/donations.js", "دوال التبرعات والصرف"),
    ("functions/users.js", "شؤون الحسابات"),
    ("functions/notifications.js", "صندوق الوارد"),
    ("functions/maintenance.js", "الصيانة الدورية"),
    ("functions/preflight.js", "فحص ما قبل الإطلاق"),
]

REPLACEMENTS = {
    "lib/errors.js": [(r"module\.exports = \{", "const E = {")],
    "lib/payments.js": [(r"module\.exports = \{[^}]*\};", "const payments = { isConfigured, createCheckoutSession, verifySession };")],
    "lib/audit.js": [(r"module\.exports = \{[^}]*\};", "const audit = { record, ACTIONS };")],
    "lib/geo.js": [(r"module\.exports = \{[^}]*\};",
                    "const geo = { distanceKm, boundingBox, withinBox, sortByDistance, validCoordinates };")],
}

# يُحذف الاستيراد النسبي وحده (`./` و`../`): الملفات صارت واحداً فلا معنى له.
# استيراد وحدات Node مثل `crypto` يبقى — حذفه كان يترك مرجعاً غير معرّف في المدمج.
DROP = re.compile(
    r"^\s*(const .*= require\([\"']\.|module\.exports\s*=\s*\{\s*(ROLES|pushToUsers|STATUS)).*$")


def clean(path: Path, rel: str) -> str:
    text = path.read_text(encoding="utf-8")
    for pattern, repl in REPLACEMENTS.get(rel, []):
        text = re.sub(pattern, repl, text, flags=re.S)

    lines, skip_block = [], False
    for line in text.split("\n"):
        if skip_block:
            if line.strip().startswith("}"):
                skip_block = False
            continue
        if re.match(r"^module\.exports = \{$", line.strip()) and rel not in REPLACEMENTS:
            skip_block = True
            continue
        if DROP.match(line) and "= {" not in line:
            continue
        if re.match(r"^module\.exports = \{.*\};$", line.strip()) and rel not in REPLACEMENTS:
            continue
        lines.append(line)

    return "\n".join(lines).strip()


def main():
    parts = ["""/**
 * مسجدي (Masjidi) — Cloud Code كاملاً في ملف واحد
 * =================================================
 * الصق هذا الملف في: Back4app → Server Settings → Cloud Code → main.js → Deploy
 *
 * مولّد آلياً من مجلد cloud/ عبر scripts/build_single_file.py
 * للتطوير طويل الأمد استخدم النسخة المجزّأة — التعديل هنا يُفقد عند إعادة التوليد.
 */
"""]

    for rel, title in ORDER:
        body = clean(ROOT / "cloud" / rel, rel)
        parts.append(f"\n// {'=' * 70}\n// {title}   [{rel}]\n// {'=' * 70}\n\n{body}\n")

    parts.append("""
// ======================================================================
// فحص حالة الخادم
// ======================================================================

Parse.Cloud.define('health', async () => ({
  ok: true,
  version: '1.0.0',
  serverTime: new Date().toISOString(),
  paymentsConfigured: payments.isConfigured(),
}));
""")

    out = ROOT / "cloud" / "main.bundle.js"
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"✓ {out}  ({len(out.read_text(encoding='utf-8').splitlines())} سطراً)")


if __name__ == "__main__":
    main()
