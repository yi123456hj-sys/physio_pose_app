// i18n_test.mjs — verifies the EN / 中文 / 한국어 switch in a real browser.
// Usage: node test/i18n_test.mjs [port]   (server on :8000 must be running)
import { launchEdge, closeEdge } from './cdp_util.mjs';

const PORT = process.argv[2] || '9225';

const EXPECT = {
  en: { appTitle: 'PhysioPose Assess', start: 'Start', stsName: '30-second Sit-to-Stand', results: 'Saved results', htmlLang: 'en' },
  zh: { appTitle: 'PhysioPose 评估', start: '开始', stsName: '30 秒坐站测试', results: '已保存结果', htmlLang: 'zh-CN' },
  ko: { appTitle: 'PhysioPose 평가', start: '시작', stsName: '30초 앉았다 일어서기', results: '저장된 결과', htmlLang: 'ko' },
};

async function checkLang(c, lang) {
  // Switch through the real UI control, then read back the rendered strings.
  await c.evaluate(`(() => {
    const sel = document.getElementById('langSelect');
    sel.value = '${lang}';
    sel.dispatchEvent(new Event('change'));
  })()`);
  await c.sleep(200);
  const state = await c.evaluate(`(() => {
    const q = (k) => document.querySelector('[data-i18n="' + k + '"]').textContent;
    return {
      selValue: document.getElementById('langSelect').value,
      selOptions: [...document.getElementById('langSelect').options].map((o) => o.value),
      htmlLang: document.documentElement.lang,
      appTitle: q('appTitle'),
      start: q('start'),
      stsName: q('stsName'),
      results: q('results'),
      stored: localStorage.getItem('physiopose.lang'),
    };
  })()`);
  const exp = EXPECT[lang];
  const ok = state.selValue === lang && state.stored === lang &&
    state.htmlLang === exp.htmlLang && state.appTitle === exp.appTitle &&
    state.start === exp.start && state.stsName === exp.stsName &&
    state.results === exp.results &&
    JSON.stringify(state.selOptions) === JSON.stringify(['en', 'zh', 'ko']);
  console.log(lang.toUpperCase(), ok ? 'PASS' : 'FAIL', JSON.stringify(state));
  return ok;
}

const c = await launchEdge(PORT);
try {
  await c.send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html' });
  await c.sleep(1200);
  await c.waitFor(`document.getElementById('langSelect') !== null`, 10000, 'app load');

  const pass = [];
  pass.push(await checkLang(c, 'ko'));

  // The choice must persist across a reload.
  await c.send('Page.reload');
  await c.sleep(1200);
  const persisted = await c.evaluate(`({
    stored: localStorage.getItem('physiopose.lang'),
    title: document.querySelector('[data-i18n="appTitle"]').textContent,
  })`);
  const persistedOk = persisted.stored === 'ko' && persisted.title === EXPECT.ko.appTitle;
  console.log('PERSIST', persistedOk ? 'PASS' : 'FAIL', JSON.stringify(persisted));
  pass.push(persistedOk);

  pass.push(await checkLang(c, 'zh'));
  pass.push(await checkLang(c, 'en'));

  if (c.consoleErrors.length || c.exceptions.length) {
    console.log('CONSOLE ERRORS:', c.consoleErrors.slice(0, 5));
    console.log('EXCEPTIONS:', c.exceptions.slice(0, 5));
  }
  const ok = pass.every(Boolean) && c.exceptions.length === 0;
  console.log(ok ? 'I18N PASS' : 'I18N FAIL');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error('I18N ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await closeEdge(c);
}
