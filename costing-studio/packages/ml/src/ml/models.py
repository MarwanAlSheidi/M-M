"""LightGBM quantile + ridge baseline. Versioned artifacts."""
from __future__ import annotations
from dataclasses import dataclass, field
from importlib.metadata import version as _v
from pathlib import Path
from typing import Dict, List, Optional

import joblib
import lightgbm as lgb
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

QUANTILES = (0.1, 0.5, 0.9)

_RUNTIME_VERSIONS = {lib: _v(lib) for lib in
                     ("lightgbm", "scikit-learn", "numpy", "pandas", "joblib")}


@dataclass
class TrainedModel:
    name: str
    version: str
    feature_cols: List[str]
    categorical_cols: List[str]
    quantile_models: Dict[float, lgb.LGBMRegressor] = field(default_factory=dict)
    ridge: Optional[Pipeline] = None
    category_dtypes: Dict[str, list] = field(default_factory=dict)
    library_versions: Dict[str, str] = field(default_factory=dict)
    target_currency: Optional[str] = None
    target_unit: Optional[str] = None

    def _prep(self, df: pd.DataFrame) -> pd.DataFrame:
        X = df[self.feature_cols].copy()
        for col, cats in self.category_dtypes.items():
            X[col] = pd.Categorical(X[col], categories=cats)
        return X

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        X = self._prep(df)
        out = pd.DataFrame(index=df.index)
        for q, m in self.quantile_models.items():
            out[f"p{int(q * 100)}"] = m.predict(X)
        if self.ridge is not None:
            out["ridge"] = self.ridge.predict(df[self.feature_cols])
        return out

    def explain(self, df: pd.DataFrame) -> pd.DataFrame:
        """SHAP via LightGBM pred_contrib on the P50 model."""
        X = self._prep(df)
        contrib = self.quantile_models[0.5].predict(X, pred_contrib=True)
        return pd.DataFrame(contrib, columns=self.feature_cols + ["__bias__"], index=df.index)

    def save(self, root: Path) -> Path:
        path = Path(root) / self.name / self.version
        path.mkdir(parents=True, exist_ok=True)
        self.library_versions = dict(_RUNTIME_VERSIONS)
        joblib.dump(self, path / "model.joblib")
        return path

    @staticmethod
    def load(path: Path) -> "TrainedModel":
        m: TrainedModel = joblib.load(Path(path) / "model.joblib")
        for lib, want in _RUNTIME_VERSIONS.items():
            got = m.library_versions.get(lib)
            if got != want:
                raise RuntimeError(f"Artifact built with {lib}={got}, runtime has {want}. Refusing to load.")
        return m


def _ridge_pipeline(cat_cols: List[str], num_cols: List[str]) -> Pipeline:
    ct = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
        ("num", StandardScaler(), num_cols),
    ])
    return Pipeline([("ct", ct), ("ridge", Ridge(alpha=1.0))])


def train(df: pd.DataFrame, feature_spec, target_col: str, name: str, version: str) -> TrainedModel:
    feature_cols = feature_spec.all_cols
    cat_cols = feature_spec.categorical
    num_cols = feature_spec.numeric
    X = df[feature_cols]
    y = df[target_col].astype(float)

    Xl = X.copy()
    for c in cat_cols:
        Xl[c] = Xl[c].astype("category")

    quantile_models = {}
    for q in QUANTILES:
        m = lgb.LGBMRegressor(
            objective="quantile", alpha=q, n_estimators=400, learning_rate=0.05,
            num_leaves=31, min_child_samples=10, subsample=0.9, colsample_bytree=0.9,
            random_state=42, verbose=-1,
        )
        m.fit(Xl, y)
        quantile_models[q] = m

    ridge = _ridge_pipeline(cat_cols, num_cols)
    ridge.fit(X, y)

    return TrainedModel(
        name=name, version=version, feature_cols=feature_cols, categorical_cols=cat_cols,
        quantile_models=quantile_models, ridge=ridge,
        category_dtypes={c: list(Xl[c].cat.categories) for c in cat_cols},
    )
