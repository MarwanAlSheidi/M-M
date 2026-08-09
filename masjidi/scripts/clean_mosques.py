#!/usr/bin/env python3
"""
تنظيف بيانات المساجد الصادرة عن وزارة الأوقاف والشؤون الدينية
Input : Masajid Data with geographic locations.xlsx  (sheet: "Data ")
Output: data/mosques.json  + data/mosques.sample.json + data/cleaning_report.json

يعالج ثلاث مشاكل معروفة في الملف الأصلي:
  1) MosqueNumber تحوّل إلى تواريخ في إكسل (1404 صف).
  2) إحداثيات مقلوبة (خط الطول مكان خط العرض) أو خارج حدود عُمان.
  3) صفوف بدون إحداثيات إطلاقاً.

الاستخدام:
    python3 scripts/clean_mosques.py "path/to/Masajid Data with geographic locations.xlsx"
"""

import json
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# الحدود الجغرافية التقريبية لسلطنة عُمان (تشمل مسندم)
OMAN_LAT = (16.4, 26.6)
OMAN_LON = (51.8, 60.2)

# سنة إصدار الملف — أي تاريخ بهذه السنة يعني أن إكسل فسّر "شهر/يوم"
FILE_YEAR = 2026

TYPE_SLUG = {
    "جامع": "jamie",
    "مسجد": "masjid",
    "مصلى": "musalla",
    "مصلى العيدين": "musalla_eid",
    "مصلى نساء ( خاص )": "musalla_women",
    "مصلى خاص بالجنائز": "musalla_janaza",
}

GOV_SLUG = {
    "مسقط": "muscat",
    "ظفار": "dhofar",
    "مسندم": "musandam",
    "البريمي": "buraimi",
    "الداخلية": "dakhiliyah",
    "شمال الباطنة": "north_batinah",
    "جنوب الباطنة": "south_batinah",
    "شمال الشرقية": "north_sharqiyah",
    "جنوب الشرقية": "south_sharqiyah",
    "الظاهرة": "dhahirah",
    "الوسطى": "wusta",
}


def fix_mosque_number(value):
    """
    يعيد بناء رقم المسجد "رمز_الولاية/التسلسل".
    إكسل حوّل القيم التي رمز ولايتها <= 12 إلى تواريخ:
      "05/1979" -> datetime(1979, 5, 1)     (سنة != سنة الملف، اليوم = 1)
      "02/6"    -> datetime(2026, 2, 6)     (سنة == سنة الملف)
    """
    if isinstance(value, (datetime, pd.Timestamp)):
        if value.year != FILE_YEAR:
            return f"{value.month:02d}/{value.year}", "recovered_from_date"
        # حالة نادرة (24 صفاً): "M/1" و "M/{FILE_YEAR}" غير قابلتين للتمييز
        flag = "recovered_ambiguous" if value.day == 1 else "recovered_from_date"
        return f"{value.month:02d}/{value.day}", flag
    return str(value).strip(), "ok"


def fix_coordinates(lon, lat):
    """يعيد (lon, lat, flag). يصحّح الانقلاب ويرفض ما هو خارج حدود عُمان."""
    if pd.isna(lon) or pd.isna(lat):
        return None, None, "missing"

    def inside(lo, la):
        return OMAN_LON[0] <= lo <= OMAN_LON[1] and OMAN_LAT[0] <= la <= OMAN_LAT[1]

    if inside(lon, lat):
        return round(float(lon), 7), round(float(lat), 7), "ok"
    if inside(lat, lon):  # الأعمدة مقلوبة
        return round(float(lat), 7), round(float(lon), 7), "swapped"
    return None, None, "out_of_bounds"


def normalize_ar(text):
    """توحيد النص العربي: إزالة التشكيل والمسافات الزائدة وتوحيد الألف والياء والتاء المربوطة."""
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("\u0640", "")  # التطويل: زخرفة تمدّ الحرف ولا تغيّر الكلمة
    for src, dst in (("أإآ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي")):
        for ch in src:
            text = text.replace(ch, dst)
    return " ".join(text.split())


def main(xlsx_path: str, out_dir: str = "data"):
    df = pd.read_excel(xlsx_path, sheet_name="Data ")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    records, report = [], {
        "source_file": Path(xlsx_path).name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rows_in": int(len(df)),
        "number_flags": {},
        "coord_flags": {},
        "dropped_no_location": 0,
        "duplicate_keys": 0,
    }

    seen = set()
    for _, row in df.iterrows():
        number, nflag = fix_mosque_number(row["MosqueNumber"])
        lon, lat, cflag = fix_coordinates(row["Longitude"], row["Latitude"])

        report["number_flags"][nflag] = report["number_flags"].get(nflag, 0) + 1
        report["coord_flags"][cflag] = report["coord_flags"].get(cflag, 0) + 1

        mtype = row["MosqueType"] if isinstance(row["MosqueType"], str) else "مسجد"
        name = str(row["MosqueName"]).strip()
        gov = str(row["Governorate"]).strip()
        wilayat = str(row["Willayat"]).strip()
        village = str(row["Village"]).strip()

        # مفتاح ثابت لمنع التكرار عند إعادة تشغيل السكربت (idempotent seeding)
        external_id = f"{number}|{normalize_ar(name)}|{normalize_ar(village)}"
        if external_id in seen:
            report["duplicate_keys"] += 1
            continue
        seen.add(external_id)

        if lat is None:
            report["dropped_no_location"] += 1
            # نحتفظ بالسجل لكن بدون موقع — يُستورد كمسجد "يحتاج تحديد موقع"
            location = None
        else:
            location = {"__type": "GeoPoint", "latitude": lat, "longitude": lon}

        records.append({
            "externalId": external_id,
            "mosqueNumber": number,
            "name": name,
            "nameNormalized": normalize_ar(name),
            "type": mtype,
            "typeSlug": TYPE_SLUG.get(mtype, "masjid"),
            "governorate": gov,
            "governorateSlug": GOV_SLUG.get(gov, ""),
            "wilayat": wilayat,
            "village": village,
            "location": location,
            "hasLocation": location is not None,
            "dataQuality": {"number": nflag, "coordinates": cflag},
            "source": "MARA Open Data 2025-2026",
            "isClaimed": False,
            "walletBalance": 0,
        })

    report["rows_out"] = len(records)

    (out / "mosques.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=None), encoding="utf-8")
    (out / "mosques.sample.json").write_text(
        json.dumps(records[:50], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "cleaning_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "Masajid Data with geographic locations.xlsx"
    main(src)
