// Asserts the CONTENT at each cited line matches what the Task-plan claims.
// Usage: node verify-plan-claims.js
const fs = require('fs');
const path = require('path');
const APP = path.resolve(__dirname, '..', '..', 'tsukuru-agent');

const at = (rel, n) => fs.readFileSync(path.join(APP, rel), 'utf8').split('\n')[n - 1] ?? '';
const whole = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
const countOf = (rel, re) => (whole(rel).match(re) || []).length;

// [claim id, description, predicate]
const CLAIMS = [
  ['RC-1a', 'styles.ts:5 & :15 = transparent --Highlight2',
    () => at('src/js/rpgmv/styles.ts', 5).includes('"--Highlight2": "#00000000"')
       && at('src/js/rpgmv/styles.ts', 15).includes('"--Highlight2": "#00000000"')],
  ['RC-1b', 'main.scss:97 .btn / :78 .btn2 / :153 #loading_bar',
    () => at('src/html/main/styles/main.scss', 97).includes('.btn{')
       && at('src/html/main/styles/main.scss', 78).includes('.btn2{')
       && at('src/html/main/styles/main.scss', 153).includes('#loading_bar{')],
  ['RC-2a', 'main.scss :root (2-11) defaults are all #000000',
    () => [3, 4, 5, 6, 7, 8].every((n) => at('src/html/main/styles/main.scss', n).includes('#000000'))],
  ['RC-2b', 'main.ts:119 assigns themeData, :120 sends getGlobalSettings',
    () => at('main.ts', 119).includes('themeData = Themes')
       && at('main.ts', 120).includes("getGlobalSettings")],
  ['RC-2c', 'renderer.ts:73 is the setProperty call',
    () => at('src/html/main/renderer.ts', 73).includes('setProperty')],
  ['RC-2d', 'main.ts:66 calls mwindow.reload()',
    () => at('main.ts', 66).includes('mwindow.reload')],
  ['RC-3', 'enlang.js has while(true) + innerHTML + 5ms sleep',
    () => /while\s*\(\s*true\s*\)/.test(whole('src/lib/enlang/enlang.js'))
       && whole('src/lib/enlang/enlang.js').includes('innerHTML')
       && whole('src/lib/enlang/enlang.js').includes('setTimeout(r, 5)')],
  ['GAP', 'styles.ts:9 & :19 have the "--Gap:" key typo',
    () => at('src/js/rpgmv/styles.ts', 9).includes('"--Gap:"')
       && at('src/js/rpgmv/styles.ts', 19).includes('"--Gap:"')],
  ['TRANS', 'main.css:163-164 and wolf/back.css:219-220 are bare `transition: 0.2s`',
    () => /transition:\s*0\.2s\s*;/.test(at('src/html/main/styles/main.css', 164))
       && /transition:\s*0\.2s\s*;/.test(at('src/html/wolf/back.css', 220))],
  ['NOACTIVE', 'zero :active rules across all 4 shipped CSS files',
    () => ['src/html/main/styles/main.css', 'src/html/wolf/back.css',
           'src/html/simple/back.css', 'src/html/config/styles.css']
          .every((f) => countOf(f, /:active/g) === 0)],
  ['NOFOCUS', 'zero :focus / :focus-visible rules across all 4 shipped CSS files',
    () => ['src/html/main/styles/main.css', 'src/html/wolf/back.css',
           'src/html/simple/back.css', 'src/html/config/styles.css']
          .every((f) => countOf(f, /:focus/g) === 0)],
  ['NOREDUCE', 'zero prefers-reduced-motion across all 4 shipped CSS files',
    () => ['src/html/main/styles/main.css', 'src/html/wolf/back.css',
           'src/html/simple/back.css', 'src/html/config/styles.css']
          .every((f) => countOf(f, /prefers-reduced-motion/g) === 0)],
  ['HOVERGATE', 'wolf/back.css:211 .runbtn:hover exists and no hover media query in file',
    () => at('src/html/wolf/back.css', 211).includes('.runbtn:hover')
       && countOf('src/html/wolf/back.css', /hover:\s*hover/g) === 0],
  ['HIDDENC', 'main.scss:206-209 mixin hiddencc, :211 .hiddenc',
    () => at('src/html/main/styles/main.scss', 206).includes('@mixin hiddencc')
       && at('src/html/main/styles/main.scss', 211).includes('.hiddenc{')],
  ['MODESWAP', 'renderer.ts:194-204 toggles the hiddenc class',
    () => [194, 195, 196, 197].some((n) => at('src/html/main/renderer.ts', n).includes('hiddenc'))],
  ['PROGRESS', 'renderer.ts:82 and wolf/rend.ts:205 set style.width',
    () => at('src/html/main/renderer.ts', 82).includes('style.width')
       && at('src/html/wolf/rend.ts', 205).includes('style.width')],
  ['DIVBTN', 'wolf/index.html:50 & :66 are div#runbtn (not <button>)',
    () => /<div[^>]*id="runbtn/.test(at('src/html/wolf/index.html', 50))
       && /<div[^>]*id="runbtn2/.test(at('src/html/wolf/index.html', 66))],
  ['EMPTYBTN', 'exactly 11 empty <button class="btn"></button> in main/index.html',
    () => countOf('src/html/main/index.html', /<button class="btn"><\/button>/g) === 11],
  ['BLANKBTN', 'wolf/index.html:76-77 changeAll/versionUp buttons have no text',
    () => /id="changeAll"><\/button>/.test(at('src/html/wolf/index.html', 76))
       && /id="versionUp"><\/button>/.test(at('src/html/wolf/index.html', 77))],
  ['BADH', 'main/index.html:56 uses the non-existent <h> element',
    () => at('src/html/main/index.html', 56).includes('<h class=')],
  ['NOHTML', 'simple + wolf index.html have no <html> tag; main has one without lang',
    () => countOf('src/html/simple/index.html', /<html/g) === 0
       && countOf('src/html/wolf/index.html', /<html/g) === 0
       && at('src/html/main/index.html', 2).trim() === '<html>'],
  ['TITLE', 'all three index.html line 10 = MV Extractor++ title',
    () => ['src/html/main/index.html', 'src/html/simple/index.html', 'src/html/wolf/index.html']
          .every((f) => at(f, 10).includes('MV Extractor++'))],
  ['STRAYLABEL', 'settings.html:24 has the unmatched </label>',
    () => at('src/html/config/settings.html', 24).includes('</label>')],
  ['NOENLANG', 'settings.html has zero enlang attributes',
    () => countOf('src/html/config/settings.html', /enlang=/g) === 0],
  ['NOLABELFOR', 'settings.html has checkboxes but zero <label for=>',
    () => countOf('src/html/config/settings.html', /type="checkbox"/g) > 0
       && countOf('src/html/config/settings.html', /<label for=/g) === 0],
  ['SEC-1a', 'main.ts:81-82 and :195-196 disable Electron isolation',
    () => at('main.ts', 81).includes('nodeIntegration: true')
       && at('main.ts', 82).includes('contextIsolation: false')
       && at('main.ts', 195).includes('nodeIntegration: true')
       && at('main.ts', 196).includes('contextIsolation: false')],
  ['SEC-1b', 'simple:5 and wolf:7 load a remote unpkg script',
    () => at('src/html/simple/index.html', 5).includes('https://unpkg.com')
       && at('src/html/wolf/index.html', 7).includes('https://unpkg.com')],
  ['SEC-1c', 'only settings.html has a CSP; the 3 main renderers have none',
    () => at('src/html/config/settings.html', 6).includes('Content-Security-Policy')
       && ['src/html/main/index.html', 'src/html/simple/index.html', 'src/html/wolf/index.html']
          .every((f) => countOf(f, /Content-Security-Policy/g) === 0)],
  ['SEC-2', 'package.json pins electron ^22, axios ^0.24, request ^2.88',
    () => /"electron":\s*"\^22\./.test(whole('package.json'))
       && /"axios":\s*"\^0\.24/.test(whole('package.json'))
       && /"request":\s*"\^2\.88/.test(whole('package.json'))],
  ['NOSASS', 'no sass dependency and no scss build script',
    () => !/"(sass|node-sass|dart-sass)":/.test(whole('package.json'))
       && !/scss/.test(whole('package.json'))],
  ['META', 'package.json name is mv-extractor-pp, repo is gramedcart/mvextractor',
    () => /"name":\s*"mv-extractor-pp"/.test(whole('package.json'))
       && /gramedcart\/mvextractor/.test(whole('package.json'))],
  ['THEMEDUP', 'Dracula and Classic theme bodies are byte-identical',
    () => {
      const s = whole('src/js/rpgmv/styles.ts');
      const bodies = [...s.matchAll(/"(?:Dracula|Classic)":\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
      return bodies.length === 2 && bodies[0] === bodies[1];
    }],
  ['ENTRY', 'main.ts:90 loads simple/index.html; :89 is the commented-out old entry',
    () => at('main.ts', 90).includes("loadFile('./src/html/simple/index.html')")
       && at('main.ts', 89).trim().startsWith('//')],
  ['GUITEST', 'no GUI markup/style/theme regression test exists yet',
    () => !fs.existsSync(path.join(APP, 'test/gui-markup.test.js'))
       && !fs.existsSync(path.join(APP, 'test/gui-styles.test.js'))
       && !fs.existsSync(path.join(APP, 'test/gui-theme.test.js'))],
];

let fail = 0;
for (const [id, desc, fn] of CLAIMS) {
  let ok = false, err = '';
  try { ok = !!fn(); } catch (e) { err = ` (${e.message})`; }
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(11)} ${desc}${err}`);
}
console.log(`\n${CLAIMS.length - fail}/${CLAIMS.length} claims verified`);
process.exit(fail ? 1 : 0);
