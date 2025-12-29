import numpy as np
from statsmodels.genmod.generalized_linear_model import GLM
import statsmodels.api as sm
from statsmodels.genmod import families
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    mean_absolute_percentage_error,
)
from scipy.stats import pearsonr


from statsmodels.genmod.generalized_linear_model import SET_USE_BIC_LLF

SET_USE_BIC_LLF(True)


def calculate_metrics(y_true, y_pred):
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)
    mape = mean_absolute_percentage_error(y_true, y_pred)
    r2 = pearsonr(y_true, y_pred)[0] ** 2
    return rmse, mae, mape, r2


def performance(df, factor):
    df_serfling = df.copy()
    outcome_var = "流感就诊百分比"

    # Generate Fourier terms for Serfling regression
    # Assuming a yearly cycle (52 weeks)
    num_weeks = 52
    num_harmonics = 2  # Number of harmonic pairs (sine and cosine)

    for h in range(1, num_harmonics + 1):
        df_serfling[f"sin_{h}"] = np.sin(
            2 * np.pi * h * df_serfling["周次"] / num_weeks
        )
        df_serfling[f"cos_{h}"] = np.cos(
            2 * np.pi * h * df_serfling["周次"] / num_weeks
        )

    # Define independent variables for the model
    # Including environmental variables and Fourier terms
    x_vars = factor[:]
    for h in range(1, num_harmonics + 1):
        x_vars.append(f"sin_{h}")
        x_vars.append(f"cos_{h}")

    # Drop rows with NaN values (if any, though preprocessed data should be clean)
    df_serfling = df_serfling.dropna().copy()

    X = df_serfling[x_vars]
    y = df_serfling[outcome_var]

    # Add a constant to the independent variables matrix for the intercept
    X = sm.add_constant(X)

    n = len(X) // 10
    x_train, y_train = X[:-n], y[:-n]
    x_test, y_test = X[-n:], y[-n:]

    # Fit GLM model (Gaussian family)
    model_serfling = GLM(y_train, x_train, family=families.Gaussian()).fit()

    # Predictions
    y_pred_serfling = model_serfling.predict(x_test)

    # Calculate performance metrics
    rmse, mae, mape, r2 = calculate_metrics(y_test, y_pred_serfling)

    # AIC and BIC for GLM
    aic = model_serfling.aic
    bic = model_serfling.bic

    return {
        "AIC": round(aic, 3),
        "BIC": round(bic, 3),
        "R2": round(r2, 3),
        "RMSE": round(rmse, 3),
        "MAE": round(mae, 3),
        "MAPE": round(mape, 3),
    }
