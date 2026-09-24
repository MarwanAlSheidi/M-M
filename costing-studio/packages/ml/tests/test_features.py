from datetime import date
import pandas as pd
from ml.features import build_frame, make_time_split


def test_cyclical_month():
    df = build_frame([{"deal_month": 1, "deal_date": date(2024, 1, 1)},
                      {"deal_month": 6, "deal_date": date(2024, 6, 1)}])
    assert "month_sin" in df and "month_cos" in df
    assert abs(df["month_sin"].iloc[0] - 0.5) < 1e-9


def test_cyclical_month_on_filtered_frame():
    df = pd.DataFrame({"deal_month": [1, 2, 3, 4]}).iloc[2:]
    out = build_frame(df)
    assert out["month_sin"].notna().all()


def test_time_split_no_leak():
    df = pd.DataFrame([{"deal_date": date(2024, 1, 1), "x": 1},
                       {"deal_date": date(2024, 6, 1), "x": 2},
                       {"deal_date": date(2025, 1, 1), "x": 3}])
    train, test = make_time_split(df, train_end=date(2024, 7, 1), test_end=date(2025, 6, 1))
    assert len(train) == 2 and len(test) == 1
    assert train["deal_date"].max() < test["deal_date"].min()
