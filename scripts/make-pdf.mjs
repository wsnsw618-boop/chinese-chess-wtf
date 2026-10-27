import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'rulebook', 'rulebook.html');
const output = path.join(root, '中国象棋WTF版-规则说明书.pdf');
const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const edge = edgeCandidates.find((candidate) => fs.existsSync(candidate));

if (!edge) {
  console.error('未找到 Edge/Chrome，无法生成 PDF。');
  console.error('请安装 Edge/Chrome，或设置 EDGE_PATH 指向浏览器可执行文件。');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`未找到规则书源文件：${source}`);
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtf-edge-pdf-'));
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  `--user-data-dir=${userDataDir}`,
  `--print-to-pdf=${output}`,
  pathToFileURL(source).href,
];

const result = spawnSync(edge, args, { stdio: 'ignore', windowsHide: true });
fs.rmSync(userDataDir, { recursive: true, force: true });

if (result.status !== 0 || !fs.existsSync(output)) {
  console.error(`PDF 生成失败（退出码 ${result.status ?? 'unknown'}）。`);
  process.exit(1);
}

const size = fs.statSync(output).size;
console.log(`规则书 PDF 已生成：${output} (${(size / 1024).toFixed(0)} KB)`);
