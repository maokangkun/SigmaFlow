"""项目技能自动导入 / 实时扫描 / 同名项目优先 / create_skill 工具。

覆盖:
- create_skill 三类 scope 行为(project 缺 workdir 报错 / project 落盘 / global 落盘+刷新)
- 技能名与必填字段校验、已存在需 overwrite
- project_skills_scan 实时读盘(写入后立即可见)
- load_skill_resolved 的同名项目优先与回落全局
"""

import textwrap
from pathlib import Path

import yaml

from sigmaflow.agent import tools as agent_tools


def _make_skill(
    root: Path, name: str, description: str, body: str = "# Skill\n正文"
) -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    front = yaml.safe_dump(
        {"name": name, "description": description}, allow_unicode=True
    )
    f = d / "SKILL.md"
    f.write_text(f"---\n{front}---\n\n{body}\n", encoding="utf-8")
    return f


def test_create_skill_requires_valid_name(tmp_path):
    out = agent_tools.create_skill("", "d", "c")
    assert out.startswith("Error:")
    out = agent_tools.create_skill("Bad_Name", "d", "c")
    assert out.startswith("Error:")
    out = agent_tools.create_skill("-bad-", "d", "c")
    assert out.startswith("Error:")


def test_create_skill_project_requires_workdir():
    agent_tools.set_session_workdir(None)
    out = agent_tools.create_skill("some-skill", "d", "c", scope="project")
    assert out.startswith("Error:")
    assert "global" in out


def test_create_skill_writes_project_dir(tmp_path):
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        out = agent_tools.create_skill(
            "pdf-fix", "修复 PDF 文本抽取", "# PDF Fix\n步骤…", scope="project"
        )
        assert out.startswith("Skill created:")
        target = tmp_path / "skills" / "pdf-fix" / "SKILL.md"
        assert target.exists()
        text = target.read_text(encoding="utf-8")
        meta, body = agent_tools.parse_skill_frontmatter(text)
        assert meta["name"] == "pdf-fix"
        assert "修复 PDF 文本抽取" in meta["description"]
        assert "PDF Fix" in body
        # 实时扫描立即可见
        scan = agent_tools.project_skills_scan(str(tmp_path))
        assert "pdf-fix" in scan
        # 重复创建需要 overwrite
        again = agent_tools.create_skill("pdf-fix", "x", "y", scope="project")
        assert again.startswith("Error:")
        assert "overwrite" in again
        ok = agent_tools.create_skill(
            "pdf-fix", "x2", "y2", scope="project", overwrite=True
        )
        assert ok.startswith("Skill created:")
    finally:
        agent_tools.set_session_workdir(None)


def test_create_skill_accepts_full_frontmatter_body(tmp_path):
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        raw = textwrap.dedent(
            """\
            ---
            name: full-form
            description: 模型自带 frontmatter 的完整文本
            ---

            # 全文形态
            """
        )
        out = agent_tools.create_skill("full-form", "d", raw, scope="project")
        assert out.startswith("Skill created:")
        meta, _body = agent_tools.parse_skill_frontmatter(
            (tmp_path / "skills" / "full-form" / "SKILL.md").read_text(encoding="utf-8")
        )
        assert meta["name"] == "full-form"
    finally:
        agent_tools.set_session_workdir(None)


def test_create_skill_global_and_live_scan(tmp_path, monkeypatch):
    gdir = tmp_path / "global-skills"
    gdir.mkdir()
    loader = agent_tools.SkillLoader(gdir)
    monkeypatch.setattr(agent_tools, "skill_loader", loader)
    out = agent_tools.create_skill("glob-skill", "全局技能描述", "# G", scope="global")
    assert out.startswith("Skill created:")
    assert (gdir / "glob-skill" / "SKILL.md").exists()
    # create_skill 已刷新 loader 视图 → get_content 直接命中
    content = agent_tools.skill_loader.get_content("glob-skill")
    assert "glob-skill" in content
    assert "全局技能描述" not in content  # description 在 frontmatter, body 才是内容


def test_load_skill_resolved_project_precedence(tmp_path, monkeypatch):
    # 全局技能 pdf-fix
    gdir = tmp_path / "global-skills"
    gdir.mkdir()
    _make_skill(gdir, "pdf-fix", "全局版本的 pdf-fix", "# GLOBAL VERSION")
    loader = agent_tools.SkillLoader(gdir)
    monkeypatch.setattr(agent_tools, "skill_loader", loader)
    # 项目技能同名覆盖
    project = tmp_path / "proj"
    _make_skill(
        project / "skills", "pdf-fix", "项目版本的 pdf-fix", "# PROJECT VERSION"
    )
    agent_tools.set_session_workdir(str(project))
    try:
        out = agent_tools.load_skill_resolved("pdf-fix")
        assert 'scope="project"' in out
        assert "# PROJECT VERSION" in out
        assert "# GLOBAL VERSION" not in out
        # 项目没有的技能回落全局
        out2 = agent_tools.load_skill_resolved("only-global")
        assert "Error" in out2  # 全局里没有 only-global → 错误列出可用清单
        _make_skill(gdir, "only-global", "只存在于全局", "# ONLY GLOBAL")
        loader._load_all()
        out3 = agent_tools.load_skill_resolved("only-global")
        assert "# ONLY GLOBAL" in out3
        assert 'scope="project"' not in out3
    finally:
        agent_tools.set_session_workdir(None)


def test_project_skills_scan_live_updates(tmp_path):
    skills = tmp_path / "skills"
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        assert agent_tools.project_skills_scan(str(tmp_path)) == {}
        _make_skill(skills, "late-skill", "会话中途新增的技能")
        # 不做任何刷新动作, 下一次扫描即可见(实时读取)
        scan = agent_tools.project_skills_scan(str(tmp_path))
        assert "late-skill" in scan
        assert scan["late-skill"]["meta"]["description"] == "会话中途新增的技能"
    finally:
        agent_tools.set_session_workdir(None)
