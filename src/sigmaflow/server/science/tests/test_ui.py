"""Browser interaction checks. Optional test dependency: pip install playwright.
The delivered application itself has zero dependencies.
This harness uses set_content (no website navigation), so it can run in restricted
CI browsers. Storage persistence is verified separately in the Node unit checks.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = []

def record(name):
    RESULTS.append({'test': name, 'status': 'passed'})
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 960}, accept_downloads=True)
    page.set_default_timeout(6000)
    errors = []
    requests = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.set_content((ROOT / 'dist/index.html').read_text(), wait_until='load')
    expect(page.locator('.home-brand h1')).to_have_text('SigmaFlow Science')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    record('Home renders with no external asset requests and no horizontal overflow')

    # Chinese IME-safe send: normal Enter submits; Shift+Enter adds a line.
    page.locator('#composer-text').fill('请展示单细胞数据分析的完整演示流程。')
    page.locator('#composer-text').press('Enter')
    expect(page.locator('[data-action="approve-run"]')).to_be_visible()
    assert page.evaluate('CS.currentRun().status') == 'awaiting'
    assert page.evaluate('CS.currentRun().progress') == 0
    record('Prompt creates a plan and waits for explicit approval')

    page.locator('[data-action="approve-run"]').click()
    page.wait_for_timeout(1700)
    page.locator('[data-action="pause-run"]').click()
    progress = page.evaluate('CS.currentRun().progress')
    page.wait_for_timeout(1000)
    assert page.evaluate('CS.currentRun().progress') == progress
    assert page.evaluate('CS.currentRun().status') == 'paused'
    page.locator('[data-action="toggle-log"][data-id="0"]').click()
    expect(page.locator('.step-log')).to_be_visible()
    record('Task pause freezes progress; logs expand')

    page.locator('[data-action="approve-run"]').click()
    # Navigate away while the timer runs, then return to the same task.
    page.locator('[data-nav="tasks"]').first.click()
    expect(page.locator('.task-row')).to_have_count(1)
    page.locator('[data-action="open-run"]').first.click()
    page.wait_for_function('CS.currentRun().status === "complete"', timeout=18000)
    page.locator('[data-action="open-results"]').click()
    expect(page.locator('#umap-chart')).to_be_visible()
    record('Task resumes, survives navigation, completes, and opens results')

    page.locator('.chart-legend [data-id="0"]').click()
    assert page.evaluate('CS.ui.group') == '0'
    assert page.locator('#umap-chart circle[opacity="0.1"]').count() > 0
    page.locator('[data-action="zoom-in"]').click()
    assert float(page.locator('#umap-chart').get_attribute('viewBox').split()[2]) < 660
    page.locator('[data-action="zoom-reset"]').click()
    expect(page.locator('#umap-chart')).to_have_attribute('viewBox', '0 0 660 405')
    page.locator('#umap-chart circle').last.click()
    expect(page.get_by_role('dialog')).to_be_visible()
    expect(page.locator('#modal-title')).to_have_text('合成细胞详情')
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    record('Chart filtering, zoom, reset, and point inspection')

    with page.expect_download() as download_info:
        page.locator('[data-action="export-report"]').first.click()
    downloaded = download_info.value
    downloaded.save_as(ROOT / 'tests' / '_downloaded_report.md')
    text = (ROOT / 'tests' / '_downloaded_report.md').read_text()
    assert '不是真实生物学分析结果' in text
    record('Actual Markdown export includes synthetic-data limitations')

    page.locator('[data-action="result-tab"][data-id="markers"]').click()
    page.locator('#marker-search').fill('MS4A1')
    expect(page.locator('tbody tr')).to_have_count(1)
    record('Expression result tabs and table filtering')

    # Data import, preview with RFC4180-style quoted fields, select and delete.
    page.locator('[data-nav="data"]').first.click()
    page.locator('[data-action="import-data"]').click()
    page.locator('#file-input').set_input_files({'name':'local_test.csv','mimeType':'text/csv','buffer':b'name,value\n"a,b",2\n"he said ""hi""",3\n'})
    expect(page.locator('.modal-body')).to_contain_text('local_test.csv')
    assert page.evaluate('CS.files.size') == 1
    page.locator('[data-action="close-modal"]').first.click()
    page.locator('#data-search').fill('local_test')
    expect(page.locator('tbody tr')).to_have_count(1)
    page.locator('button[data-action="preview-data"]').first.click()
    expect(page.locator('.modal tbody tr')).to_have_count(2)
    expect(page.locator('.modal tbody tr').first).to_contain_text('a,b')
    page.keyboard.press('Escape')
    page.locator('input[data-check-dataset]').check()
    page.locator('[data-action="delete-datasets"]').click()
    page.locator('[data-action="confirm-delete-datasets"]').click()
    assert page.evaluate('CS.files.size') == 0
    assert not page.evaluate('CS.state.datasets.some(d=>d.name==="local_test.csv")')
    record('Local file import, safe quoted CSV preview, selection and record removal')

    page.locator('[data-nav="projects"]').first.click()
    page.locator('[data-action="new-project"]').last.click()
    hostile = '<img src=x onerror=alert(1)>'
    page.locator('#project-name').fill(hostile)
    page.locator('#project-description').fill('测试项目与安全转义')
    page.locator('#project-tags').fill('UI, 测试')
    page.locator('button[form="project-form"]').click()
    assert page.locator('img').count() == 0
    expect(page.locator('.project-grid')).to_contain_text(hostile)
    project_id = page.evaluate('CS.state.projects.at(-1).id')
    page.locator(f'[data-action="edit-project"][data-id="{project_id}"]').click()
    page.locator('#project-name').fill('test_research_project')
    page.locator('button[form="project-form"]').click()
    page.locator(f'[data-action="edit-project"][data-id="{project_id}"]').click()
    page.locator('[data-action="archive-project"]').click()
    page.locator('[data-action="project-tab"][data-id="archived"]').click()
    expect(page.locator('.project-grid')).to_contain_text('test_research_project')
    record('Projects create/edit/archive correctly; user HTML is escaped')

    page.locator('[data-nav="literature"]').first.click()
    page.locator('[data-action="bookmark-paper"]').first.click()
    assert page.evaluate('CS.state.bookmarks.length') == 1
    page.locator('[data-action="paper-note"]').first.click()
    page.locator('#paper-note-text').fill('这是一条阅读笔记。<script>alert(1)</script>')
    page.locator('button[form="note-form"]').click()
    page.locator('[data-action="paper-note"]').first.click()
    expect(page.locator('#paper-note-text')).to_have_value('这是一条阅读笔记。<script>alert(1)</script>')
    # Modal keyboard cycling remains within the dialog.
    page.locator('button[form="note-form"]').focus()
    page.keyboard.press('Tab')
    assert page.evaluate('!!document.activeElement.closest(".modal")')
    page.keyboard.press('Escape')
    record('Literature bookmarks, safe notes, Escape dismissal and modal focus trap')

    page.locator('[data-nav="tools"]').first.click()
    page.locator('#sequence-input').fill('>a\nACGTNN\n>b\nGGCC')
    page.locator('[data-action="compute-sequence"]').click()
    assert page.evaluate('CS.ui.sequenceResult[0].length') == 6
    assert page.evaluate('CS.ui.sequenceResult[0].gc') == '50.00'
    assert page.evaluate('CS.ui.sequenceResult[1].gc') == '100.00'
    page.locator('#sequence-input').fill('123***')
    page.locator('[data-action="compute-sequence"]').click()
    expect(page.locator('#toast-root')).to_contain_text('IUPAC')
    record('Real browser-side FASTA statistics and invalid-input handling')

    page.locator('[data-nav="workflows"]').first.click()
    page.locator('[data-action="select-workflow"][data-id="quality"]').click()
    page.locator('[data-action="toggle-advanced"]').click()
    page.locator('#min-genes').fill('500')
    page.locator('#max-mito').fill('10')
    page.locator('[data-action="start-workflow"]').click()
    assert page.evaluate('CS.currentRun().config.minGenes') == 500
    assert page.evaluate('CS.currentRun().workflowId') == 'quality'
    page.locator('[data-action="cancel-run"]').click()
    assert page.evaluate('CS.currentRun().status') == 'cancelled'
    record('Workflow selection, parameter recording and task cancellation')

    page.locator('[data-nav="settings"]').first.click()
    page.locator('[data-action="setting-toggle"][data-id="contrast"]').click()
    expect(page.locator('html')).to_have_attribute('data-contrast','high')
    page.locator('[data-action="setting-toggle"][data-id="contrast"]').click()
    record('High-contrast accessibility preference')

    # Every route must work at desktop and mobile widths without horizontal overflow.
    for width,height in [(1440,960),(768,1024),(390,844)]:
        page.set_viewport_size({'width':width,'height':height})
        for route in ['home','projects','data','workflows','results','literature','tools','tasks','settings','help']:
            page.evaluate('(route)=>CS.navigate(route)',route)
            page.wait_for_timeout(70)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), (width,route)
        if width==390:
            page.locator('.mobile-menu').click()
            expect(page.locator('.sidebar')).to_have_class('sidebar open')
            page.locator('.sidebar [data-nav="home"]').click()
            assert not page.evaluate('CS.ui.mobileSidebar')
    record('10 routes at 1440px / 768px / 390px and mobile sidebar')

    assert not errors, errors
    assert not requests, requests
    record('No uncaught browser exceptions; no external network requests in local demo')
    browser.close()

(ROOT / 'tests' / 'browser-results.json').write_text(json.dumps({'tests':RESULTS,'count':len(RESULTS),'environment':'Chromium headless, standalone HTML via set_content; Node tests cover storage utilities'},ensure_ascii=False,indent=2))
print(f'\n{len(RESULTS)} browser interaction checks passed.')
