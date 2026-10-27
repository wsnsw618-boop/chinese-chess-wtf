import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function copy(from, to) {
  if (!fs.existsSync(from)) {
    console.warn(`跳过（不存在）：${from}`);
    return;
  }
  fs.copyFileSync(from, to);
  console.log(`已复制：${path.basename(to)}`);
}

copy(path.join(dist, 'index.html'), path.join(dist, 'game.html'));
copy(path.join(dist, 'index.html'), path.join(dist, '中国象棋WTF版.html'));
copy(path.join(root, 'src', 'rulebook', 'rulebook.html'), path.join(dist, 'rulebook.html'));
copy(path.join(root, '中国象棋WTF版-规则说明书.pdf'), path.join(dist, '中国象棋WTF版-规则说明书.pdf'));

console.log('打包完成。双击 启动游戏.bat 即可游玩。');
