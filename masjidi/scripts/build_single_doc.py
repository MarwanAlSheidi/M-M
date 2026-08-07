#!/usr/bin/env python3
"""تجميع المشروع كاملاً في ملف واحد: MASJIDI.md"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "MASJIDI.md"

HEADER = """# مسجدي (Masjidi) — الملف الهندسي الكامل

**الإصدار:** 1.0.0
**آخر تحديث:** أغسطس 2026

منصة تربط أئمة المساجد في سلطنة عُمان بالمتطوعين والشركات المعتمدة والمتبرعين،
لإدارة أعمال الصيانة بشفافية. Backend على Parse Server (Back4app)، مهيّأ مسبقاً
بـ **18,214 مسجداً** من البيانات المفتوحة لوزارة الأوقاف والشؤون الدينية.

> **هذا الملف يحتوي المشروع كاملاً** — السياق، المراجعة، المخطط، كل كود السحابة،
> وسكربتات التجهيز. الاستثناء الوحيد هو ملف البيانات `mosques.json` (11 ميغابايت،
> 18 ألف سجل) — يُولَّد من السكربت في القسم 9.

## كيف تستخدمه

**مع Claude Code:** ضع هذا الملف في مجلد فارغ باسم `CLAUDE.md`، شغّل `claude`،
واطلب منه تفكيكه إلى البنية الموصوفة في القسم 3.

**يدوياً:** انسخ كود القسم 6 إلى `main.js` في لوحة Back4app والصقه مباشرة.

---

## الفهرس

| # | القسم |
|---|---|
| 1 | [الحالة والقيود](#1-الحالة-والقيود) |
| 2 | [قواعد العمل](#2-قواعد-العمل) |
| 3 | [البنية](#3-البنية) |
| 4 | [مراجعة الكود الأصلي — ثغرات حرجة](#4-مراجعة-الكود-الأصلي) |
| 5 | [مخطط قاعدة البيانات](#5-مخطط-قاعدة-البيانات) |
| 6 | [كود السحابة كاملاً](#6-كود-السحابة-كاملاً) |
| 7 | [دورة حياة الطلب والدوال](#7-دورة-حياة-الطلب-والدوال) |
| 8 | [البيانات](#8-البيانات) |
| 9 | [سكربتات التجهيز](#9-سكربتات-التجهيز) |
| 10 | [خطة التشغيل](#10-خطة-التشغيل) |

---
"""


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8").strip()


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
sections.append("## 5. مخطط قاعدة البيانات\n\nاحفظه في `cloud/schema.json` وطبّقه عبر السكربت في القسم 9.\n\n```json\n"
                + read("cloud/schema.json") + "\n```")

# 6
sections.append("## 6. كود السحابة كاملاً\n\nالصقه في `main.js` داخل Back4app → Cloud Code → Deploy.\n\n```javascript\n"
                + read("cloud/main.bundle.js") + "\n```")

# 7
spec = read("docs/PROJECT_SPEC.md")
lifecycle = spec.split("## 5. دورة حياة الطلب")[1].split("## 7. قواعد الأمن")[0].strip().replace("## 6. دوال السحابة", "### دوال السحابة")
roles = spec.split("## 3. الأدوار")[1].split("## 4. مخطط")[0].strip()
sections.append("## 7. دورة حياة الطلب والدوال\n\n### الأدوار\n" + roles + "\n\n### دورة الحياة\n" + lifecycle)

# 8
sections.append("## 8. البيانات\n\n" + demote(strip_h1(read("docs/DATA.md"))))

# 9
sections.append("## 9. سكربتات التجهيز\n\n"
                "### `scripts/clean_mosques.py` — تنظيف ملف الوزارة\n\n```python\n"
                + read("scripts/clean_mosques.py") + "\n```\n\n"
                "### `scripts/apply_schema.js` — تطبيق المخطط\n\n```javascript\n"
                + read("scripts/apply_schema.js") + "\n```\n\n"
                "### `scripts/seed_mosques.js` — استيراد 18 ألف مسجد\n\n```javascript\n"
                + read("scripts/seed_mosques.js") + "\n```\n\n"
                "### `.env.example`\n\n```bash\n" + read(".env.example") + "\n```\n\n"
                "### `package.json`\n\n```json\n" + read("package.json") + "\n```")

# 10
readme = read("README.md")
steps = readme.split("## البدء")[1].split("## قبل أي تعديل")[0].strip()
launch = spec.split("## 9. خطة الإطلاق")[1].strip()
sections.append("## 10. خطة التشغيل\n\n" + steps + "\n\n### مراحل الإطلاق\n\n" + launch)

OUT.write_text(HEADER + "\n" + "\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
print(f"✓ {OUT}  ({len(OUT.read_text(encoding='utf-8').splitlines())} سطراً، "
      f"{OUT.stat().st_size // 1024} كيلوبايت)")
