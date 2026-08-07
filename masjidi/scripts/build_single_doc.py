#!/usr/bin/env python3
"""تجميع المشروع كاملاً في ملف واحد: MASJIDI.md"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "MASJIDI.md"

BT = "`"

# ترتيب التحميل نفسه في cloud/main.js — المُشغّلات قبل الدوال.
CLOUD_FILES = [
    "cloud/main.js",
    "cloud/triggers.js",
    "cloud/lib/errors.js",
    "cloud/lib/auth.js",
    "cloud/lib/push.js",
    "cloud/lib/payments.js",
    "cloud/lib/audit.js",
    "cloud/lib/geo.js",
    "cloud/functions/mosques.js",
    "cloud/functions/requests.js",
    "cloud/functions/donations.js",
    "cloud/functions/users.js",
    "cloud/functions/maintenance.js",
]

TEST_FILES = [
    ("tests/helpers/parse-mock.js", "بديل Parse — مخزن في الذاكرة بلا خادم"),
    ("tests/donations.test.js", "المسار المالي: التأكيد والحجز"),
    ("tests/triggers.test.js", "حماية الأدوار وإقفال الحساب على صاحبه"),
    ("tests/requests.test.js", "دورة حياة الطلب والإلغاء والصرف"),
    ("tests/audit.test.js", "سجل التدقيق والمهمة الدورية"),
    ("tests/users.test.js", "الحسابات والاسترداد والبحث"),
    ("tests/schema.test.js", "الصلاحيات وتطابق النسختين"),
    ("tests/integration/harness.js", "تشغيل parse-server حقيقي فوق PostgreSQL"),
    ("tests/integration/flow.test.js", "الرحلة الكاملة على خادم حقيقي"),
]

HEADER = """# مسجدي (Masjidi) — الملف الهندسي الكامل

**الإصدار:** 1.0.0
**آخر تحديث:** أغسطس 2026

منصة تربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة والمتبرعين،
لإدارة أعمال الصيانة بشفافية. Backend على Parse Server (Back4app)، مهيّأ مسبقاً
بـ **18,214 مسجداً** من البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية.

> **هذا الملف يحتوي المشروع كاملاً** — السياق، المراجعة، المخطط، كل كود السحابة
> (مجزّأً ومدمجاً)، وكل السكربتات بما فيها مولّدا هذا الملف نفسه، فيمكن للملف أن
> يُعيد إنتاج نفسه. المستثنى ملفّا البيانات المولّدان وحدهما:
> `data/mosques.json` (11 ميغابايت، 18 ألف سجل) و`data/mosques.sample.json` —
> كلاهما يُولَّد من سكربت التنظيف في القسم 9.

## كيف تستخدمه

**مع Claude Code:** ضع هذا الملف في مجلد فارغ باسم `CLAUDE.md`، شغّل `claude`،
واطلب منه تفكيكه إلى البنية الموصوفة في القسم 3. استخدم **القسم 6أ** — وهو
الملفات كما هي على القرص بكامل `require` و`module.exports`. لا تُفكّك القسم 6ب.

**يدوياً:** انسخ كود **القسم 6ب** (الملف المدمج) إلى `main.js` في لوحة Back4app
والصقه مباشرة.

---

## الفهرس

| # | القسم |
|---|---|
| 1 | [الحالة والقيود](#1-الحالة-والقيود) |
| 2 | [قواعد العمل](#2-قواعد-العمل) |
| 3 | [البنية](#3-البنية) |
| 4 | [مراجعة الكود الأصلي — ثغرات حرجة](#4-مراجعة-الكود-الأصلي) |
| 5 | [مخطط قاعدة البيانات](#5-مخطط-قاعدة-البيانات) |
| 6 | [كود السحابة كاملاً — مجزّأً (6أ) ومدمجاً (6ب)](#6-كود-السحابة-كاملاً) |
| 7 | [دورة حياة الطلب والدوال وقواعد الأمن](#7-دورة-حياة-الطلب-والدوال-وقواعد-الأمن) |
| 8 | [البيانات](#8-البيانات) |
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) — و[الاختبارات](#9ب-الاختبارات) |
| 10 | [خطة التشغيل](#10-خطة-التشغيل) |

---
"""


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8").strip()


def fence(text, lang=""):
    """
    يُحيط النص بسياج أطول من أطول سلسلة علامات اقتباس خلفية داخله.

    يلزم لأن القسم 9 يُضمّن هذا السكربت في نفسه: لو كان السياج ثابتاً بثلاث
    علامات لأغلقه أول سياج داخل النص وانكسر الملف عند أول إعادة توليد.
    """
    longest = max((len(run) for run in re.findall(BT + "+", text)), default=0)
    bar = BT * max(3, longest + 1)
    return f"{bar}{lang}\n{text}\n{bar}"


def block(rel, lang):
    """كتلة كود لملف على القرص، معنونة بمساره."""
    return f"#### `{rel}`\n\n" + fence(read(rel), lang)


def strip_h1(text):
    lines = text.split("\n")
    if lines[0].startswith("# "):
        lines = lines[1:]
    return "\n".join(lines).strip()


def demote(text, levels=1):
    """خفض مستوى العناوين لتندرج تحت أقسام هذا الملف."""
    out = []
    for line in text.split("\n"):
        if line.startswith("#"):
            out.append("#" * levels + line)
        else:
            out.append(line)
    return "\n".join(out)


sections = []

# 1
sections.append("## 1. الحالة والقيود\n\n" + demote(strip_h1(read("CLAUDE.md")).split("## البنية")[0].split("## ما هو المشروع")[1].strip()))

# 2
claude_md = read("CLAUDE.md")
rules = claude_md.split("## قواعد العمل في هذا المستودع")[1].split("## القيود المهمة")[0].strip()
constraints = claude_md.split("## القيود المهمة")[1].split("## الخطوات التالية")[0].strip()
sections.append("## 2. قواعد العمل\n\n" + rules + "\n\n### القيود المهمة\n\n" + constraints)

# 3
structure = claude_md.split("## البنية")[1].split("## قواعد العمل")[0].strip()
sections.append("## 3. البنية\n\n" + structure)

# 4
sections.append("## 4. مراجعة الكود الأصلي\n\n" + demote(strip_h1(read("docs/REVIEW.md"))))

# 5
sections.append("## 5. مخطط قاعدة البيانات\n\nاحفظه في `cloud/schema.json` وطبّقه عبر السكربت في القسم 9.\n\n"
                + fence(read("cloud/schema.json"), "json"))

# 6
# المجزّأة أولاً: هي وحدها القابلة لإعادة بناء المستودع، لأن المدمجة تُحذف منها
# أسطر require/module.exports فلا تعمل قطعها كوحدات منفصلة.
sections.append(
    "## 6. كود السحابة كاملاً\n\n"
    "### 6أ — النسخة المجزّأة (لإعادة بناء المستودع)\n\n"
    "الملفات كما هي على القرص، بكامل `require` و`module.exports`. هذه هي النسخة\n"
    "التي تُفكَّك إلى البنية الموصوفة في القسم 3. المخطط `cloud/schema.json` في\n"
    "القسم 5.\n\n"
    + "\n\n".join(block(rel, "javascript") for rel in CLOUD_FILES)
    + "\n\n### 6ب — النسخة المدمجة (للصق في Back4app)\n\n"
      "مولّدة آلياً من ملفات القسم 6أ عبر `scripts/build_single_file.py`، وقد حُذفت\n"
      "منها أسطر `require` و`module.exports` لتعمل كملف واحد. **لا تُفكّك هذه النسخة**\n"
      "— قطعها بلا استيراد ولا تصدير ولن تُحمَّل كوحدات منفصلة؛ استخدم القسم 6أ.\n\n"
      "الصقها في `main.js` داخل Back4app → Cloud Code → Deploy.\n\n"
    + fence(read("cloud/main.bundle.js"), "javascript")
)

# 7
spec = read("docs/PROJECT_SPEC.md")
lifecycle = spec.split("## 5. دورة حياة الطلب")[1].split("## 9. خطة الإطلاق")[0].strip()
for src, dst in (
    ("## 6. دوال السحابة", "### دوال السحابة"),
    ("## 7. قواعد الأمن", "### قواعد الأمن"),
    ('## 8. تكامل منصة "أيادي" (مستقبلاً)', '### تكامل منصة "أيادي" (مستقبلاً)'),
):
    lifecycle = lifecycle.replace(src, dst)
roles = spec.split("## 3. الأدوار")[1].split("## 4. مخطط")[0].strip()
sections.append("## 7. دورة حياة الطلب والدوال وقواعد الأمن\n\n### الأدوار\n" + roles
                + "\n\n### دورة الحياة\n" + lifecycle)

# 8
sections.append("## 8. البيانات\n\n" + demote(strip_h1(read("docs/DATA.md"))))

# 9
sections.append("## 9. سكربتات التجهيز\n\n"
                "### `scripts/clean_mosques.py` — تنظيف ملف الوزارة\n\n"
                + fence(read("scripts/clean_mosques.py"), "python") + "\n\n"
                "### `scripts/apply_schema.js` — تطبيق المخطط\n\n"
                + fence(read("scripts/apply_schema.js"), "javascript") + "\n\n"
                "### `scripts/seed_mosques.js` — استيراد 18 ألف مسجد\n\n"
                + fence(read("scripts/seed_mosques.js"), "javascript") + "\n\n"
                "### `scripts/build_single_file.py` — توليد النسخة المدمجة (القسم 6ب)\n\n"
                + fence(read("scripts/build_single_file.py"), "python") + "\n\n"
                "### `scripts/build_single_doc.py` — توليد هذا الملف\n\n"
                + fence(read("scripts/build_single_doc.py"), "python") + "\n\n"
                "### `.env.example`\n\n" + fence(read(".env.example"), "bash") + "\n\n"
                "### `.gitignore`\n\n" + fence(read(".gitignore"), "gitignore") + "\n\n"
                "### `package.json`\n\n" + fence(read("package.json"), "json") + "\n\n"
                "## 9ب. الاختبارات\n\n"
                "`npm test` — تعمل على بديل Parse في الذاكرة، بلا خادم ولا مفاتيح.\n"
                "ترصد أخطاء المنطق لا أخطاء المنصّة؛ ما يخرج عن تغطيتها مذكور في\n"
                "«ما لم يُعالَج» بالقسم 4.\n\n"
                + "\n\n".join(
                    f"#### `{rel}` — {note}\n\n" + fence(read(rel), "javascript")
                    for rel, note in TEST_FILES))

# 10
readme = read("README.md")
steps = readme.split("## البدء")[1].split("## قبل أي تعديل")[0].strip()
launch = spec.split("## 9. خطة الإطلاق")[1].strip()
sections.append("## 10. خطة التشغيل\n\n" + steps + "\n\n### مراحل الإطلاق\n\n" + launch)

OUT.write_text(HEADER + "\n" + "\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
print(f"✓ {OUT}  ({len(OUT.read_text(encoding='utf-8').splitlines())} سطراً، "
      f"{OUT.stat().st_size // 1024} كيلوبايت)")
