.PHONY: sync
sync:
	uv sync --all-extras --all-packages --group dev

.PHONY: format
format:
	uv run ruff format
	uv run ruff check --fix

.PHONY: format-check
format-check:
	uv run ruff format --check

.PHONY: lint
lint:
	uv run ruff check

.PHONY: mypy
mypy:
	uv run mypy .

.PHONY: tests
tests:
	uv run pytest

# Science 工作区回归: 后端 API(HTTP+SSE+WS) + 前端语法/UI 检查;
# build 后 dist 必须与源码一致, 防止"改了源码忘记重建就提交"
.PHONY: science-regression
science-regression:
	uv run python src/sigmaflow/server/science/tests/test_backend.py
	cd src/sigmaflow/server/science && node scripts/check.mjs
	cd src/sigmaflow/server/science && node scripts/build.mjs
	git diff --exit-code -- src/sigmaflow/server/science/dist/index.html

# 提交前准入: 双套全绿(包级测试 + science 回归)
.PHONY: test-all
test-all: tests science-regression

.PHONY: coverage
coverage:
	uv run coverage run -m pytest
	uv run coverage xml -o coverage.xml
	uv run coverage html -d htmlcov
	uv run coverage report -m --fail-under=95
