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
    outcome_var = "流感就诊百分比"
    exposure_vars = factor[:]
    lags = 3  # 滞后阶数（默认为3）

    # 创建滞后变量和非线性项
    df_dlnm = df.copy()
    x_vars = []

    for exposure_var in exposure_vars:
        # 创建滞后变量
        for i in range(1, lags + 1):
            lag_col = f"{exposure_var}_lag{i}"
            df_dlnm[lag_col] = df_dlnm[exposure_var].shift(i)
            x_vars.append(lag_col)

        # 添加非线性项（二次项）
        sq_col = f"{exposure_var}_sq"
        df_dlnm[sq_col] = df_dlnm[exposure_var] ** 2
        x_vars.append(sq_col)

    # 添加原始暴露变量
    x_vars.extend(exposure_vars)

    # 删除因滞后产生的缺失值
    df_dlnm = df_dlnm.dropna()

    # Prepare data for GLM
    X = df_dlnm[x_vars]
    y = df_dlnm[outcome_var]

    # Add a constant to the independent variables matrix for the intercept
    X = sm.add_constant(X)

    n = len(X) // 10
    x_train, y_train = X[:-n], y[:-n]
    x_test, y_test = X[-n:], y[-n:]

    # Fit GLM model (assuming a Gaussian family for simplicity, can be adjusted)
    # For DLNM, often a quasi-Poisson or negative binomial is used for count data,
    # but for percentage, Gaussian might be a starting point or log-transformed outcome.
    # Given it's a percentage, we'll stick with Gaussian for now, but note this simplification.
    model_dlnm = GLM(y_train, x_train, family=families.Gaussian()).fit()

    # Predictions
    y_pred_dlnm = model_dlnm.predict(x_test)

    # Calculate performance metrics
    rmse, mae, mape, r2 = calculate_metrics(y_test, y_pred_dlnm)

    # AIC and BIC for GLM
    aic = model_dlnm.aic
    bic = model_dlnm.bic

    return {
        "AIC": round(aic, 3),
        "BIC": round(bic, 3),
        "R2": round(r2, 3),
        "RMSE": round(rmse, 3),
        "MAE": round(mae, 3),
        "MAPE": round(mape, 3),
    }
