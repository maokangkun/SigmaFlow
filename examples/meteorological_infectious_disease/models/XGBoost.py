import numpy as np
import xgboost as xgb
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
    r2_score,
)


def calculate_metrics(y_true, y_pred):
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)
    mape = mean_absolute_percentage_error(y_true, y_pred)
    r2 = r2_score(y_true, y_pred)
    return rmse, mae, mape, r2


def performance(df, factor):
    outcome_var = "流感就诊百分比"

    # Prepare data for XGBoost
    X = df[factor]
    y = df[outcome_var]
    n = len(X) // 10
    x_train, y_train = X[:-n], y[:-n]
    x_test, y_test = X[-n:], y[-n:]

    # Initialize and train XGBoost Regressor
    # Using default parameters for simplicity, can be tuned for better performance
    xgbr = xgb.XGBRegressor(objective="reg:squarederror", random_state=42)
    xgbr.fit(x_train, y_train)

    # Predictions
    y_pred_xgb = xgbr.predict(x_test)

    # Calculate performance metrics
    rmse, mae, mape, r2 = calculate_metrics(y_test, y_pred_xgb)

    return {
        "AIC": None,
        "BIC": None,
        "R2": round(r2, 3),
        "RMSE": round(rmse, 3),
        "MAE": round(mae, 3),
        "MAPE": round(mape, 3),
    }
