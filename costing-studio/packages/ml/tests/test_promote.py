from ml.promote import should_promote


def test_first_model_must_beat_baseline():
    d = should_promote({}, {"n_folds": 3, "mape_mean": 0.10, "coverage_mean": 0.8},
                       baseline_metrics={"n_folds": 3, "mape_mean": 0.08})
    assert not d.promoted


def test_first_model_promoted_when_beats_baseline():
    d = should_promote({}, {"n_folds": 3, "mape_mean": 0.05, "coverage_mean": 0.8},
                       baseline_metrics={"n_folds": 3, "mape_mean": 0.08})
    assert d.promoted


def test_empty_challenger_rejected():
    assert not should_promote({}, {"n_folds": 0}).promoted


def test_relative_gain_required():
    champ = {"n_folds": 3, "mape_mean": 0.05, "coverage_mean": 0.8}
    chal = {"n_folds": 3, "mape_mean": 0.049, "coverage_mean": 0.8}
    assert not should_promote(champ, chal).promoted
