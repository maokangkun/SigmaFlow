import numpy as np
from pygam import LinearGAM, s
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
)
from scipy.stats import pearsonr
from functools import reduce


def calculate_metrics(y_true, y_pred):
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)
    mape = mean_absolute_percentage_error(y_true, y_pred)
    r2 = pearsonr(y_true, y_pred)[0] ** 2
    return rmse, mae, mape, r2


def performance(df, factor):
    outcome_var = "流感就诊百分比"

    # Prepare data for GAM
    X = df[factor].values
    y = df[outcome_var].values
    n = len(X) // 10
    x_train, y_train = X[:-n], y[:-n]
    x_test, y_test = X[-n:], y[-n:]

    # Build GAM model with smoothing splines for each continuous variable
    # The 's' function indicates a smoothing spline term
    terms = reduce(lambda a, b: a + b, [s(i) for i in range(len(factor))])
    gam = LinearGAM(terms)

    # Fit GAM model
    gam.fit(x_train, y_train)

    # Predictions
    y_pred_gam = gam.predict(x_test)

    # Calculate performance metrics
    rmse, mae, mape, r2 = calculate_metrics(y_test, y_pred_gam)

    return {
        "AIC": None,
        "BIC": None,
        "R2": round(r2, 3),
        "RMSE": round(rmse, 3),
        "MAE": round(mae, 3),
        "MAPE": round(mape, 3),
    }
