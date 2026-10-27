import { AIClient } from '../ai/client';
import { Game, cloneDuel } from '../game/state';
import {
  BLACK,
  Color,
  Difficulty,
  GameMode,
  Move,
  PieceType,
  RED,
  TransformChoice,
  coord,
  pieceName,
  sideName,
  typeOf,
} from '../game/types';
import { cannonChargeRemaining, isInCheck } from '../game/moves';
import rulebookHtml from '../rulebook/rulebook.html?raw';
import { BoardView, DuelHighlight } from './boardView';
import {
  ReplayFrame,
  SavedGameRecord,
  buildReplayFrames,
  buildRecordBundle,
  defaultRecordName,
  loadSavedRecords,
  makeRecordId,
  parseRecordBundle,
  persistSavedRecords,
  restoreFeaturedRecords,
  seedFeaturedRecords,
} from './records';
import { SoundManager } from './sound';

const VERSION = '1.5.2';

interface Settings {
  sound: boolean;
  coordinates: boolean;
  replaySpeed: number;
}

const DEFAULT_SETTINGS: Settings = {
  sound: true,
  coordinates: true,
  replaySpeed: 5,
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  expert: '专家',
};

const RECOMMENDED_OPENINGS: readonly string[] = [
  '豹 b1→c3',
  '狼 g4→g5',
  '狼 e4→e5',
  '妖 h3→g3',
  '妖 b3→b4',
  '象 c1→e3',
  '狼 d4→d5',
  '豹 h1→g3',
  '象 g1→e3',
];

const DUEL_REASON: Record<string, string> = {
  pieces: '双方均不大于 5 子',
  repetition: '同一局面三次重复',
  superpieces: '双方虎坦龙仙全部被吃',
  agreement: '双方同意提前进入',
  noProgress: '长时间无有效进展',
};

const RESULT_REASON: Record<string, string> = {
  checkmate: '将死',
  stalemate: '困毙',
  singleKing: '单王',
  perpetualCheck: '长将判负',
  perpetualChase: '长捉判负',
  resign: '认输',
  duelMate: '生死斗将死',
  noMoves: '无子可走',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('wtf-chess-settings');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const merged = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    const speed = Number(merged.replaySpeed);
    merged.replaySpeed = Number.isFinite(speed)
      ? Math.min(15, Math.max(2, Math.round(speed)))
      : DEFAULT_SETTINGS.replaySpeed;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

interface ModalHandle {
  overlay: HTMLElement;
  close: () => void;
}

export class App {
  private root: HTMLElement;
  private game: Game;
  private ai: AIClient;
  private sound = new SoundManager();
  private board: BoardView | null = null;

  private screen: 'start' | 'game' | 'library' | 'replay' = 'start';
  private mode: GameMode = 'pvp';
  private humanColor: Color = RED;
  private difficulty: Difficulty = 'normal';
  private flipped = false;
  private selected: number | null = null;
  private legalForSelected: Move[] = [];
  private aiThinking = false;
  private aiGeneration = 0;
  private resultShown = false;
  private settings: Settings = loadSettings();
  private modal: ModalHandle | null = null;
  private modalOpen = false;
  private duelModalOpen = false;
  private duelBusy = false;
  private duelDock: HTMLElement | null = null;
  private duelCollapsed = false;
  private duelSelector: Color | null = null;
  private duelCandidates: Array<{
    square: number;
    piece: number;
    targets: Array<PieceType.Tiger | PieceType.Dragon>;
  }> = [];
  private duelChoices = new Map<number, PieceType.Tiger | PieceType.Dragon>();
  private duelFocused: number | null = null;
  private duelOpponentChoices: TransformChoice[] = [];
  private suppressUpdates = false;
  private aiInfo = '';
  private savedRecords: SavedGameRecord[] = [];
  private savedCurrent = false;
  private replayRecord: SavedGameRecord | null = null;
  private replayFrames: ReplayFrame[] = [];
  private replayIndex = 0;
  private replayTimer: number | null = null;
  private replayBoard: BoardView | null = null;
  private replayGame: Game | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.game = new Game();
    this.ai = new AIClient();
    this.sound.setEnabled(this.settings.sound);
    this.game.subscribe(() => this.onGameChange());
    this.savedRecords = loadSavedRecords();
    const seeded = seedFeaturedRecords(this.savedRecords);
    this.savedRecords = seeded.records;
    if (seeded.changed) persistSavedRecords(this.savedRecords);
    this.renderStart();
  }

  private isAI(color: Color): boolean {
    return this.mode === 'ai' && color !== this.humanColor;
  }

  private onGameChange(): void {
    if (this.suppressUpdates) return;
    if (this.screen !== 'game' || !this.board) return;
    this.updateGameUI();
    if (this.game.duel.phase === 'selection') {
      window.setTimeout(() => this.handleDuelSelection(), 40);
    } else if (!this.game.gameOver && this.mode === 'ai' && this.game.position.turn !== this.humanColor) {
      window.setTimeout(() => this.maybeAI(), 360);
    }
  }

  // -------------------------------------------------------------------------
  // Start screen
  // -------------------------------------------------------------------------

  private renderStart(): void {
    this.pauseReplay();
    this.replayBoard?.destroy();
    this.replayBoard = null;
    this.replayGame = null;
    this.replayRecord = null;
    this.replayFrames = [];
    this.screen = 'start';
    const chips = ['虎', '豹', '象', '奴', '妖', '狼', '霸', '坦', '骑', '牛', '卫', '巫', '勇', '王'];
    this.root.innerHTML = `
      <div class="start-screen">
        <div class="start-glow"></div>
        <div class="hero-chips">
          ${chips
            .map(
              (name, i) =>
                `<span class="hero-chip ${i % 2 ? 'black' : 'red'}" style="--i:${i}">${name}</span>`,
            )
            .join('')}
        </div>
        <div class="start-inner">
          <div class="brand-block">
            <div class="brand-kicker">剧毒术士（离谱暗封剑） · 奇幻象棋</div>
            <h1>中国象棋<span>WTF</span>版</h1>
            <p class="brand-tagline">虎豹象奴妖狼霸 · 一场不讲道理的象棋</p>
            <div class="brand-rule"></div>
            <p class="brand-desc">双人对战 / 四档人机 / 完整生死斗规则 / 离线可玩</p>
          </div>

          <div class="mode-grid">
            <button class="mode-card" id="pvp-card" type="button">
              <span class="mode-icon">双</span>
              <span class="mode-title">双人对战</span>
              <span class="mode-desc">同一台电脑，轮流落子</span>
              <span class="mode-cta">开始对局 →</span>
            </button>
            <button class="mode-card mode-ai" id="ai-card" type="button">
              <span class="mode-icon">机</span>
              <span class="mode-title">人机对战</span>
              <span class="mode-desc">四档 AI，执红或执黑</span>
              <span class="mode-cta">配置对局 →</span>
            </button>
          </div>

          <div class="replay-entry-wrap">
            <button class="replay-entry" id="replay-link" type="button">
              <span class="replay-entry-icon">谱</span>
              <span class="replay-entry-text">
                <strong>棋谱观赏</strong>
                <small>保存 / 回看 / 重命名 / 删除对局 · 内置 10 局教学棋谱</small>
              </span>
              <span class="replay-entry-cta">进入 →</span>
            </button>
          </div>

          <div class="ai-setup hidden" id="ai-setup">
            <div class="setup-row">
              <span class="setup-label">选择执方</span>
              <div class="segmented" id="side-segment">
                <button type="button" class="segment active" data-side="red">执红先手</button>
                <button type="button" class="segment" data-side="black">执黑后手</button>
              </div>
            </div>
            <div class="setup-row">
              <span class="setup-label">AI 难度</span>
              <div class="segmented" id="difficulty-segment">
                <button type="button" class="segment" data-difficulty="easy">简单</button>
                <button type="button" class="segment active" data-difficulty="normal">普通</button>
                <button type="button" class="segment" data-difficulty="hard">困难</button>
                <button type="button" class="segment" data-difficulty="expert">专家</button>
              </div>
            </div>
            <button class="primary-btn wide" id="ai-start" type="button">开始人机对战</button>
          </div>

          <div class="start-footer">
            <button class="link-btn" id="rules-link" type="button">规则说明</button>
            <span class="dot-sep">·</span>
            <button class="link-btn" id="about-link" type="button">关于</button>
            <span class="dot-sep">·</span>
            <span class="dev-credit">开发者：剧毒术士（离谱暗封剑）</span>
          </div>
          <div class="version-line">中国象棋WTF版 v${VERSION} · 规则已冻结</div>
        </div>
      </div>
    `;

    const pvpCard = this.root.querySelector<HTMLButtonElement>('#pvp-card');
    const aiCard = this.root.querySelector<HTMLButtonElement>('#ai-card');
    const aiSetup = this.root.querySelector<HTMLElement>('#ai-setup');
    pvpCard?.addEventListener('click', () => this.startGame('pvp', RED, 'normal'));
    aiCard?.addEventListener('click', () => {
      aiSetup?.classList.toggle('hidden');
      aiCard.classList.toggle('active');
    });

    let side: Color = RED;
    let difficulty: Difficulty = 'normal';
    this.root.querySelectorAll<HTMLButtonElement>('#side-segment .segment').forEach((seg) => {
      seg.addEventListener('click', () => {
        this.root.querySelectorAll('#side-segment .segment').forEach((s) => s.classList.remove('active'));
        seg.classList.add('active');
        side = seg.dataset.side === 'black' ? BLACK : RED;
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('#difficulty-segment .segment').forEach((seg) => {
      seg.addEventListener('click', () => {
        this.root
          .querySelectorAll('#difficulty-segment .segment')
          .forEach((s) => s.classList.remove('active'));
        seg.classList.add('active');
        difficulty = (seg.dataset.difficulty as Difficulty) ?? 'normal';
      });
    });
    this.root.querySelector<HTMLButtonElement>('#ai-start')?.addEventListener('click', () => {
      this.startGame('ai', side, difficulty);
    });

    this.root.querySelector<HTMLButtonElement>('#rules-link')?.addEventListener('click', () => this.openRules());
    this.root.querySelector<HTMLButtonElement>('#about-link')?.addEventListener('click', () => this.openAbout());
    this.root.querySelector<HTMLButtonElement>('#replay-link')?.addEventListener('click', () => this.openLibrary());
  }

  // -------------------------------------------------------------------------
  // Game screen
  // -------------------------------------------------------------------------

  private startGame(mode: GameMode, humanColor: Color, difficulty: Difficulty): void {
    this.sound.play('click');
    this.suppressUpdates = true;
    this.aiGeneration += 1;
    this.mode = mode;
    this.humanColor = humanColor;
    this.difficulty = difficulty;
    this.flipped = mode === 'ai' && humanColor === BLACK;
    this.selected = null;
    this.legalForSelected = [];
    this.aiThinking = false;
    this.resultShown = false;
    this.savedCurrent = false;
    this.clearDuelDock();
    this.duelModalOpen = false;
    this.duelBusy = false;
    this.aiInfo = '';
    this.game.newGame({ mode, humanColor, difficulty });
    this.screen = 'game';
    this.closeModal(false);
    this.renderGame();
    this.suppressUpdates = false;
    this.updateGameUI();
    window.setTimeout(() => this.maybeAI(), 280);
  }

  private renderGame(): void {
    this.root.innerHTML = `
      <div class="game-screen">
        <header class="game-topbar">
          <button class="topbar-back" id="back-btn" type="button">← 首页</button>
          <div class="topbar-title">中国象棋<span>WTF</span>版</div>
          <div class="topbar-meta">
            <span class="meta-pill" id="mode-badge">双人对战</span>
            <span class="meta-pill duel-pill hidden" id="duel-badge"></span>
          </div>
        </header>

        <main class="game-main">
          <section class="board-column">
            <div class="board-frame">
              <canvas id="board-canvas" aria-label="中国象棋WTF版棋盘"></canvas>
            </div>
            <div class="duel-banner hidden" id="duel-banner"></div>
            <div class="board-caption" id="board-caption">红方先行 · 点击棋子查看走法</div>
          </section>

          <aside class="side-panel">
            <div class="player-strip black" id="black-player">
              <div class="player-head"><span class="player-dot black"></span><span class="player-name">黑方</span><span class="ai-tag hidden">AI</span></div>
              <div class="captured-row" id="black-captured"></div>
            </div>

            <div class="status-card" id="status-card">
              <div class="status-turn">
                <span class="turn-dot" id="turn-dot"></span>
                <span id="turn-label">红方行棋</span>
              </div>
              <div class="status-sub" id="status-sub"></div>
              <div class="status-meter"><span id="status-meter-fill"></span></div>
            </div>

            <div class="player-strip red" id="red-player">
              <div class="player-head"><span class="player-dot red"></span><span class="player-name">红方</span><span class="ai-tag hidden">AI</span></div>
              <div class="captured-row" id="red-captured"></div>
            </div>

            <div class="panel-card moves-card">
              <div class="card-head"><span>行棋记录</span><span class="muted" id="move-count">0</span></div>
              <ol class="move-list" id="move-list"></ol>
            </div>

            <div class="panel-actions">
              <div class="action-grid">
                <button class="action-btn" id="new-btn" type="button">新局</button>
                <button class="action-btn" id="undo-btn" type="button">悔棋</button>
                <button class="action-btn danger" id="resign-btn" type="button">认输</button>
                <button class="action-btn" id="duel-btn" type="button">提前生死斗</button>
                <button class="action-btn" id="save-btn" type="button" disabled>保存棋谱</button>
              </div>
              <div class="action-grid secondary">
                <button class="action-btn ghost" id="flip-btn" type="button">翻转棋盘</button>
                <button class="action-btn ghost" id="rules-btn" type="button">规则</button>
                <button class="action-btn ghost" id="opening-guide-btn" type="button">推荐首着</button>
                <button class="action-btn ghost" id="ai-help-btn" type="button">AI 说明</button>
                <button class="action-btn ghost" id="settings-btn" type="button">设置</button>
              </div>
            </div>
          </aside>
        </main>
      </div>
    `;

    const canvas = this.root.querySelector<HTMLCanvasElement>('#board-canvas');
    if (!canvas) throw new Error('Board canvas missing');
    this.board = new BoardView(this.game, {
      canvas,
      onSquareClick: (sq) => this.handleSquareClick(sq),
      showCoordinates: this.settings.coordinates,
    });
    this.board.setFlipped(this.flipped);

    this.root.querySelector<HTMLButtonElement>('#back-btn')?.addEventListener('click', () => this.returnHome());
    this.root.querySelector<HTMLButtonElement>('#new-btn')?.addEventListener('click', () => this.handleNewGame());
    this.root.querySelector<HTMLButtonElement>('#undo-btn')?.addEventListener('click', () => this.handleUndo());
    this.root.querySelector<HTMLButtonElement>('#resign-btn')?.addEventListener('click', () => this.handleResign());
    this.root.querySelector<HTMLButtonElement>('#duel-btn')?.addEventListener('click', () => this.handleOfferDuel());
    this.root.querySelector<HTMLButtonElement>('#save-btn')?.addEventListener('click', () => this.handleSaveRecord());
    this.root.querySelector<HTMLButtonElement>('#flip-btn')?.addEventListener('click', () => this.handleFlip());
    this.root.querySelector<HTMLButtonElement>('#rules-btn')?.addEventListener('click', () => this.openRules());
    this.root.querySelector<HTMLButtonElement>('#opening-guide-btn')?.addEventListener('click', () => this.openOpeningGuide());
    this.root.querySelector<HTMLButtonElement>('#ai-help-btn')?.addEventListener('click', () => this.openAIHelp());
    this.root.querySelector<HTMLButtonElement>('#settings-btn')?.addEventListener('click', () => this.openSettings());
  }

  private updateGameUI(): void {
    if (this.screen !== 'game' || !this.board) return;

    if (this.duelDock && this.game.duel.phase !== 'selection') {
      this.clearDuelDock();
    }

    if (this.selected !== null) {
      const piece = this.game.position.board[this.selected];
      if (!piece || Math.sign(piece) !== this.game.position.turn) {
        this.selected = null;
        this.legalForSelected = [];
      } else {
        this.legalForSelected = this.game.legalMovesFrom(this.selected);
      }
    }

    this.board.setSelected(this.selected, this.legalForSelected);
    this.board.render();

    const modeBadge = this.root.querySelector<HTMLElement>('#mode-badge');
    if (modeBadge) {
      modeBadge.textContent =
        this.mode === 'pvp'
          ? '双人对战'
          : `人机 · ${DIFFICULTY_LABEL[this.difficulty]} · 执${
              this.humanColor === RED ? '红' : '黑'
            }`;
    }
    const duelBadge = this.root.querySelector<HTMLElement>('#duel-badge');
    if (duelBadge) {
      if (this.game.duel.count > 0) {
        duelBadge.textContent = `第 ${this.game.duel.count} 次生死斗`;
        duelBadge.classList.remove('hidden');
      } else {
        duelBadge.classList.add('hidden');
      }
    }

    this.updateStatus();
    this.updatePlayers();
    this.updateMoveList();
    this.updateDuelBanner();
    this.updateButtons();

    if (this.duelDock && this.game.duel.phase === 'selection') {
      this.refreshDuelDock();
    }

    if (this.game.result && !this.resultShown) {
      this.resultShown = true;
      this.sound.play('win');
      window.setTimeout(() => this.showGameOver(), 260);
    }
  }

  private updateStatus(): void {
    const card = this.root.querySelector<HTMLElement>('#status-card');
    const turnLabel = this.root.querySelector<HTMLElement>('#turn-label');
    const statusSub = this.root.querySelector<HTMLElement>('#status-sub');
    const turnDot = this.root.querySelector<HTMLElement>('#turn-dot');
    const meter = this.root.querySelector<HTMLElement>('#status-meter-fill');
    const caption = this.root.querySelector<HTMLElement>('#board-caption');
    if (!card || !turnLabel || !statusSub || !turnDot || !meter) return;

    const turn = this.game.position.turn;
    const selectedPiece =
      this.selected !== null ? this.game.position.board[this.selected] : 0;
    const selectedCannonCharge =
      selectedPiece && typeOf(selectedPiece) === PieceType.Cannon && this.selected !== null
        ? cannonChargeRemaining(this.game.position, this.selected)
        : 0;
    const chargeHint = '该妖/巫刚移动过：需间隔一回合才能隔两子吃子';
    turnDot.className = `turn-dot ${turn === RED ? 'red' : 'black'}`;
    card.classList.toggle('red-turn', turn === RED);
    card.classList.toggle('black-turn', turn === BLACK);
    card.classList.remove('in-check');

    if (this.game.result) {
      turnLabel.textContent = '对局结束';
      statusSub.textContent = this.game.result.message;
      meter.style.width = '100%';
      if (caption) caption.textContent = '对局结束 · 点击“新局”再来一盘';
      return;
    }

    if (this.aiThinking) {
      turnLabel.textContent = 'AI 思考中';
      statusSub.textContent = '正在搜索最佳着法…';
      meter.style.width = '58%';
    } else if (this.game.duel.phase === 'countdown') {
      turnLabel.textContent = `${sideName(turn)}行棋`;
      statusSub.textContent = `生死斗倒计时 ${this.game.duel.countdown} 步 · ${DUEL_REASON[this.game.duel.reason ?? 'pieces'] ?? ''}`;
      meter.style.width = `${((3 - this.game.duel.countdown + 1) / 3) * 100}%`;
    } else if (this.game.duel.phase === 'selection') {
      turnLabel.textContent = '生死斗 · 选子';
      statusSub.textContent = this.duelDock
        ? `点击棋盘上的己方棋子，再选虎/龙 · 已选 ${this.duelChoices.size}/2`
        : '双方选择升变棋子';
      meter.style.width = '100%';
    } else if (this.game.duel.phase === 'restriction') {
      turnLabel.textContent = `${sideName(turn)}行棋`;
      statusSub.textContent = `生死斗限制回合 · 新子不可将死（剩余 ${this.game.duel.restrictionPlies} 手）${
        selectedCannonCharge > 0 ? ' · 妖/巫蓄力中' : ''
      }`;
      meter.style.width = '100%';
    } else {
      turnLabel.textContent = `${sideName(turn)}行棋`;
      const check = isInCheck(this.game.position, turn);
      statusSub.textContent = check
        ? '将军！必须应将'
        : selectedCannonCharge > 0
          ? chargeHint
          : this.aiInfo || '点击棋子查看合法落点';
      meter.style.width = check ? '100%' : '46%';
      card.classList.toggle('in-check', check);
    }

    if (caption) {
      const check = isInCheck(this.game.position, turn);
      caption.textContent = check
        ? '将军！'
        : this.game.duel.phase === 'countdown'
          ? `生死斗将在 ${this.game.duel.countdown} 步后开始`
          : this.game.duel.phase === 'selection'
            ? this.duelDock
              ? `选子：已选 ${this.duelChoices.size}/2 · 点击棋盘上的己方棋子`
              : '生死斗选子中'
            : selectedCannonCharge > 0
              ? chargeHint
              : '红方先行 · 点击棋子查看走法';
    }
  }

  private updatePlayers(): void {
    const lostRed: number[] = [];
    const lostBlack: number[] = [];
    for (const record of this.game.moveRecords) {
      const move = record.move;
      if (move.kind === 'swapGuard') continue;
      const captured = move.captured;
      if (!captured) continue;
      if (captured > 0) lostRed.push(captured);
      else lostBlack.push(captured);
    }

    const renderLost = (container: HTMLElement | null, pieces: number[]) => {
      if (!container) return;
      container.innerHTML = '';
      if (!pieces.length) {
        container.innerHTML = '<span class="muted small">暂无损失</span>';
        return;
      }
      for (const piece of pieces) {
        const chip = el('span', `captured-chip ${piece > 0 ? 'red' : 'black'}`, pieceName(piece));
        chip.title = pieceName(piece);
        container.appendChild(chip);
      }
    };

    renderLost(this.root.querySelector<HTMLElement>('#red-captured'), lostRed);
    renderLost(this.root.querySelector<HTMLElement>('#black-captured'), lostBlack);

    for (const [id, color] of [
      ['#red-player', RED],
      ['#black-player', BLACK],
    ] as Array<[string, Color]>) {
      const strip = this.root.querySelector<HTMLElement>(id);
      if (!strip) continue;
      strip.classList.toggle('ai-side', this.isAI(color));
      strip.classList.toggle('active-side', this.game.position.turn === color && !this.game.result);
      const tag = strip.querySelector<HTMLElement>('.ai-tag');
      if (tag) tag.classList.toggle('hidden', !this.isAI(color));
    }
  }

  private updateMoveList(): void {
    const list = this.root.querySelector<HTMLOListElement>('#move-list');
    const count = this.root.querySelector<HTMLElement>('#move-count');
    if (!list) return;
    list.innerHTML = '';
    const records = this.game.moveRecords;
    records.forEach((record, index) => {
      const li = el('li', 'move-row');
      if (index === records.length - 1) li.classList.add('last');
      const no = el('span', 'ply-no', `${index + 1}.`);
      const dot = el('span', `side-dot ${record.mover === RED ? 'red' : 'black'}`);
      const text = el('span', 'move-text', record.notation);
      li.append(no, dot, text);
      if (record.check) {
        const tag = el('span', 'check-tag', '将');
        li.appendChild(tag);
      }
      list.appendChild(li);
    });
    if (!records.length) {
      list.innerHTML = '<li class="move-empty">尚未落子</li>';
    }
    if (count) count.textContent = String(records.length);
    list.scrollTop = list.scrollHeight;
  }

  private updateDuelBanner(): void {
    const banner = this.root.querySelector<HTMLElement>('#duel-banner');
    if (!banner) return;
    const duel = this.game.duel;
    banner.className = 'duel-banner';
    if (duel.phase === 'none') {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    if (duel.phase === 'countdown') {
      banner.classList.add('countdown');
      banner.innerHTML = `
        <div class="duel-kicker">生死斗 · 倒计时</div>
        <div class="duel-count"><strong>${duel.countdown}</strong><span>步</span></div>
        <div class="duel-sub">${DUEL_REASON[duel.reason ?? 'pieces'] ?? ''}</div>
      `;
    } else if (duel.phase === 'selection') {
      banner.classList.add('selection');
      banner.innerHTML = `
        <div class="duel-kicker">生死斗 · 选子</div>
        <div class="duel-headline">双方选择升变棋子</div>
        <div class="duel-sub">先选方先走 · 新子下一步不可将死</div>
      `;
    } else if (duel.phase === 'restriction') {
      banner.classList.add('restriction');
      banner.innerHTML = `
        <div class="duel-kicker">生死斗 · 限制回合</div>
        <div class="duel-headline">新子不可将死</div>
        <div class="duel-sub">红黑各一步 · 剩余 ${duel.restrictionPlies} 手</div>
      `;
    }
  }

  private updateButtons(): void {
    const setDisabled = (id: string, disabled: boolean) => {
      const btn = this.root.querySelector<HTMLButtonElement>(id);
      if (btn) btn.disabled = disabled;
    };
    const busy = this.aiThinking || this.game.duel.phase === 'selection';
    setDisabled('#undo-btn', busy || !this.game.canUndo());
    setDisabled('#duel-btn', busy || !this.game.canOfferDuel());
    setDisabled('#resign-btn', this.game.gameOver);
    const saveBtn = this.root.querySelector<HTMLButtonElement>('#save-btn');
    if (saveBtn) {
      saveBtn.disabled = !this.game.gameOver || this.savedCurrent;
      saveBtn.textContent = this.savedCurrent ? '棋谱已保存' : '保存棋谱';
    }
    const flipBtn = this.root.querySelector<HTMLButtonElement>('#flip-btn');
    if (flipBtn) {
      flipBtn.title =
        this.mode === 'ai' && !this.game.gameOver
          ? '交换你与 AI 的执方，并按当前行棋顺序继续'
          : '翻转棋盘视角';
    }
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private handleSquareClick(sq: number): void {
    if (this.game.gameOver || this.aiThinking) return;
    if (this.game.duel.phase === 'selection') {
      if (this.duelDock) this.handleDuelSquareClick(sq);
      return;
    }
    if (this.mode === 'ai' && this.game.position.turn !== this.humanColor) return;

    const turn = this.game.position.turn;
    const piece = this.game.position.board[sq];

    if (this.selected === null) {
      if (piece && Math.sign(piece) === turn) {
        this.selectSquare(sq);
      }
      return;
    }

    if (sq === this.selected) {
      this.clearSelection();
      return;
    }

    const move = this.legalForSelected.find((m) => m.to === sq);
    if (move) {
      this.playMove(move);
      return;
    }

    if (piece && Math.sign(piece) === turn) {
      this.selectSquare(sq);
    } else {
      this.clearSelection();
    }
  }

  private selectSquare(sq: number): void {
    this.selected = sq;
    this.legalForSelected = this.game.legalMovesFrom(sq);
    this.board?.setSelected(sq, this.legalForSelected);
    this.updateStatus();
    this.sound.play('click');
  }

  private clearSelection(): void {
    this.selected = null;
    this.legalForSelected = [];
    this.board?.setSelected(null, []);
    this.updateStatus();
  }

  private playMove(move: Move): boolean {
    const before = this.game.position.turn;
    const success = this.game.makeMove(move);
    if (!success) {
      this.toast('该着法当前不可行');
      return false;
    }
    this.clearSelection();
    this.sound.play(
      this.game.result
        ? 'win'
        : isInCheck(this.game.position, this.game.position.turn)
          ? 'check'
          : move.captured
            ? 'capture'
            : 'move',
    );
    if (before === this.game.position.turn) this.updateGameUI();
    return true;
  }

  // -------------------------------------------------------------------------
  // AI
  // -------------------------------------------------------------------------

  private maybeAI(): void {
    if (this.screen !== 'game' || this.game.gameOver) return;
    if (this.modalOpen || this.aiThinking) return;
    if (this.game.duel.phase === 'selection') {
      void this.handleDuelSelection();
      return;
    }
    if (this.mode !== 'ai' || this.game.position.turn === this.humanColor) return;

    const turn = this.game.position.turn;
    const token = ++this.aiGeneration;
    this.aiThinking = true;
    this.updateGameUI();

    const restriction =
      this.game.duel.phase === 'restriction'
        ? {
            forbidNewPieceMate: true,
            newlyTransformedIds: [...this.game.duel.newlyTransformedIds],
          }
        : undefined;

    void this.ai
      .requestMove(this.game.position.clone(), this.difficulty, restriction)
      .then((payload) => {
        if (
          token !== this.aiGeneration ||
          this.screen !== 'game' ||
          this.game.gameOver ||
          this.game.position.turn !== turn
        ) {
          return;
        }
        this.aiThinking = false;
        this.aiInfo = `AI：深度 ${payload.depth} · ${payload.nodes.toLocaleString()} 节点`;
        const move =
          payload.move ??
          this.game.legalMoves()[Math.floor(Math.random() * this.game.legalMoves().length)];
        if (move) {
          this.clearSelection();
          if (!this.game.makeMove(move)) {
            const fallback = this.game.legalMoves()[0];
            if (fallback) this.game.makeMove(fallback);
          }
          this.sound.play(
            this.game.result
              ? 'win'
              : isInCheck(this.game.position, this.game.position.turn)
                ? 'check'
                : move.captured
                  ? 'capture'
                  : 'move',
          );
        }
        this.updateGameUI();
      })
      .catch((error: unknown) => {
        if (token !== this.aiGeneration || this.screen !== 'game') return;
        this.aiThinking = false;
        this.aiInfo = '';
        this.toast(error instanceof Error ? error.message : 'AI 运行失败');
        this.updateGameUI();
      });
  }

  private async handleDuelSelection(): Promise<void> {
    if (this.screen !== 'game' || this.game.duel.phase !== 'selection') return;
    if (this.duelModalOpen || this.duelBusy) return;

    const duel = this.game.duel;
    const selector =
      duel.firstChoices === null
        ? duel.firstSelector
        : duel.secondChoices === null
          ? duel.secondSelector
          : null;
    if (!selector) return;

    const opponentChoices =
      selector === duel.secondSelector ? (duel.firstChoices ?? []) : undefined;
    const opponentColor = selector === duel.secondSelector ? duel.firstSelector : undefined;

    if (this.isAI(selector)) {
      this.duelBusy = true;
      this.updateGameUI();
      const token = this.aiGeneration;
      try {
        const choices = await this.ai.requestSelection(
          this.game.position.clone(),
          selector,
          opponentChoices ?? undefined,
          opponentColor ?? undefined,
        );
        if (token !== this.aiGeneration || this.game.duel.phase !== 'selection') return;
        this.game.selectTransformations(selector, choices);
      } catch (error) {
        if (token !== this.aiGeneration) return;
        this.toast(error instanceof Error ? error.message : 'AI 选子失败');
        this.game.selectTransformations(selector, []);
      } finally {
        if (token === this.aiGeneration) this.duelBusy = false;
      }
      if (token !== this.aiGeneration) return;
      this.sound.play('duel');
      if (this.game.duel.phase === 'selection') {
        window.setTimeout(() => void this.handleDuelSelection(), 60);
      } else {
        this.updateGameUI();
        window.setTimeout(() => this.maybeAI(), 300);
      }
      return;
    }

    this.duelModalOpen = true;
    this.openDuelSelectionDock(selector, opponentChoices ?? []);
  }

  private clearDuelDock(): void {
    this.duelDock?.remove();
    this.duelDock = null;
    this.duelModalOpen = false;
    this.duelSelector = null;
    this.duelCandidates = [];
    this.duelChoices.clear();
    this.duelFocused = null;
    this.duelOpponentChoices = [];
    this.board?.setDuelHighlights(new Map());
  }

  private closeDuelDock(refresh = true): void {
    this.clearDuelDock();
    if (refresh) this.updateGameUI();
  }

  private openDuelSelectionDock(selector: Color, opponentChoices: TransformChoice[]): void {
    const candidates = this.game.getSelectionCandidates(selector);
    if (!candidates.length) {
      this.duelModalOpen = false;
      this.game.selectTransformations(selector, []);
      this.sound.play('duel');
      window.setTimeout(() => void this.handleDuelSelection(), 60);
      return;
    }

    this.clearDuelDock();
    this.duelSelector = selector;
    this.duelCandidates = candidates;
    this.duelOpponentChoices = opponentChoices;
    this.duelFocused = candidates[0]?.square ?? null;
    this.duelModalOpen = true;
    this.duelCollapsed = window.innerWidth < 720;
    this.clearSelection();
    this.buildDuelDock();
    this.refreshDuelDock();
  }

  private buildDuelDock(): void {
    const color = this.duelSelector;
    if (!color) return;
    const dock = el('div', 'duel-dock');
    dock.id = 'duel-dock';

    const head = el('div', 'duel-dock-head');
    const title = el('div', 'duel-dock-title');
    title.append(
      el('span', 'duel-kicker', '生死斗 · 选子'),
      el('strong', '', `${sideName(color)}选子`),
    );
    const toggle = button('收起', 'duel-dock-toggle', () => this.toggleDuelDock());
    head.append(title, toggle);

    const body = el('div', 'duel-dock-body');
    const hint = el(
      'p',
      'duel-dock-hint',
      '点击棋盘上的己方棋子，再选择虎/龙。最多选择两个；看不清时可以最小化面板。',
    );
    const opponent = el('div', 'duel-opponent hidden');
    const focus = el('div', 'duel-focus');
    const selected = el('div', 'duel-selected');

    const details = el('details', 'duel-candidate-list');
    const summary = el('summary', '', `候选棋子（${this.duelCandidates.length}）`);
    const grid = el('div', 'duel-candidate-grid');
    for (const candidate of this.duelCandidates) {
      const chip = button(
        `${pieceName(candidate.piece)} · ${coord(candidate.square)}`,
        'duel-candidate-btn',
        () => this.focusDuelCandidate(candidate.square),
      );
      chip.dataset.square = String(candidate.square);
      grid.appendChild(chip);
    }
    details.append(summary, grid);

    const footer = el('div', 'duel-dock-footer');
    const counter = el('span', 'duel-counter', '已选 0 / 2');
    const confirm = button('不升变，继续', 'primary-btn', () => this.confirmDuelSelection());
    confirm.id = 'duel-confirm';
    footer.append(counter, confirm);

    body.append(hint, opponent, focus, selected, details, footer);
    dock.append(head, body);
    document.body.appendChild(dock);
    this.duelDock = dock;
  }

  private refreshDuelDock(): void {
    const dock = this.duelDock;
    const color = this.duelSelector;
    if (!dock || !color) return;

    dock.classList.toggle('collapsed', this.duelCollapsed);
    const toggle = dock.querySelector<HTMLButtonElement>('.duel-dock-toggle');
    if (toggle) toggle.textContent = this.duelCollapsed ? '展开' : '收起';

    const opponent = dock.querySelector<HTMLElement>('.duel-opponent');
    if (opponent) {
      opponent.innerHTML = '';
      if (this.duelOpponentChoices.length) {
        opponent.classList.remove('hidden');
        opponent.appendChild(el('span', 'summary-label', '对手已选'));
        const opponentColor = color === RED ? BLACK : RED;
        for (const choice of this.duelOpponentChoices) {
          const piece = this.game.position.board[choice.square];
          opponent.appendChild(
            el(
              'span',
              'summary-choice',
              `${pieceName(piece)} ${coord(choice.square)} → ${this.duelTargetName(choice.target, opponentColor)}`,
            ),
          );
        }
      } else {
        opponent.classList.add('hidden');
      }
    }

    const focus = dock.querySelector<HTMLElement>('.duel-focus');
    if (focus) {
      focus.innerHTML = '';
      const candidate = this.duelCandidates.find((c) => c.square === this.duelFocused);
      if (!candidate) {
        focus.appendChild(el('p', 'duel-focus-empty', '先在棋盘上点击一个己方棋子。'));
      } else {
        const head = el('div', 'duel-focus-head');
        const glyph = el(
          'span',
          `choice-glyph ${color === RED ? 'red' : 'black'}`,
          pieceName(candidate.piece),
        );
        const info = el('div', 'duel-focus-info');
        info.append(
          el('div', 'duel-focus-name', `${pieceName(candidate.piece)} · ${coord(candidate.square)}`),
          el('div', 'duel-focus-sub', '选择升变目标，或点另一个棋子切换'),
        );
        head.append(glyph, info);

        const targets = el('div', 'duel-focus-targets');
        for (const target of candidate.targets) {
          const tb = button(
            this.duelTargetName(target, color),
            'target-btn',
            () => this.setDuelTarget(candidate.square, target),
          );
          tb.dataset.target = String(target);
          tb.classList.toggle('active', this.duelChoices.get(candidate.square) === target);
          targets.appendChild(tb);
        }
        focus.append(head, targets);
      }
    }

    const selected = dock.querySelector<HTMLElement>('.duel-selected');
    if (selected) {
      selected.innerHTML = '';
      if (!this.duelChoices.size) {
        selected.appendChild(el('div', 'duel-selected-empty', '尚未选择；也可以直接确认跳过升变。'));
      } else {
        const order = new Map<number, number>();
        [...this.duelChoices.keys()].forEach((square, index) => order.set(square, index + 1));
        for (const [square, target] of this.duelChoices) {
          const piece = this.game.position.board[square];
          const chip = el('div', 'duel-chip');
          chip.append(
            el(
              'span',
              'duel-chip-text',
              `${order.get(square)}. ${pieceName(piece)} ${coord(square)} → ${this.duelTargetName(target, color)}`,
            ),
            button('×', 'duel-chip-remove', () => {
              this.duelChoices.delete(square);
              this.refreshDuelDock();
            }),
          );
          chip.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('.duel-chip-remove')) return;
            this.focusDuelCandidate(square);
          });
          selected.appendChild(chip);
        }
      }
    }

    const counter = dock.querySelector<HTMLElement>('.duel-counter');
    if (counter) counter.textContent = `已选 ${this.duelChoices.size} / 2`;
    const confirm = dock.querySelector<HTMLButtonElement>('#duel-confirm');
    if (confirm) confirm.textContent = this.duelChoices.size ? '确认升变' : '不升变，继续';

    dock.querySelectorAll<HTMLButtonElement>('.duel-candidate-btn').forEach((chip) => {
      const square = Number(chip.dataset.square);
      chip.classList.toggle('selected', this.duelChoices.has(square));
      chip.classList.toggle('focused', this.duelFocused === square);
    });

    this.refreshDuelHighlights();
    this.updateStatus();
  }

  private refreshDuelHighlights(): void {
    const color = this.duelSelector;
    if (!color) {
      this.board?.setDuelHighlights(new Map());
      return;
    }
    const order = new Map<number, number>();
    [...this.duelChoices.keys()].forEach((square, index) => order.set(square, index + 1));
    const highlights = new Map<number, DuelHighlight>();
    for (const candidate of this.duelCandidates) {
      const target = this.duelChoices.get(candidate.square);
      highlights.set(candidate.square, {
        candidate: true,
        focused: candidate.square === this.duelFocused,
        order: order.get(candidate.square),
        targetLabel: target ? this.duelTargetName(target, color) : undefined,
      });
    }
    this.board?.setDuelHighlights(highlights);
  }

  private duelTargetName(target: PieceType.Tiger | PieceType.Dragon, color: Color): string {
    if (target === PieceType.Tiger) return color === RED ? '虎' : '坦';
    return color === RED ? '龙' : '仙';
  }

  private setDuelTarget(square: number, target: PieceType.Tiger | PieceType.Dragon): void {
    const current = this.duelChoices.get(square);
    if (current === target) {
      this.duelChoices.delete(square);
    } else {
      if (!current && this.duelChoices.size >= 2) {
        this.toast('最多只能选择两个棋子');
        return;
      }
      this.duelChoices.set(square, target);
    }
    this.duelFocused = square;
    this.duelCollapsed = false;
    this.refreshDuelDock();
  }

  private focusDuelCandidate(square: number): void {
    if (!this.duelCandidates.some((candidate) => candidate.square === square)) {
      this.toast('只能选择自己的非王棋子');
      return;
    }
    if (!this.duelChoices.has(square) && this.duelChoices.size >= 2) {
      this.toast('最多只能选择两个棋子');
      return;
    }
    this.duelFocused = square;
    this.duelCollapsed = false;
    this.refreshDuelDock();
  }

  private handleDuelSquareClick(square: number): void {
    const candidate = this.duelCandidates.find((item) => item.square === square);
    if (!candidate) {
      this.toast('请在棋盘上选择自己的非王棋子');
      return;
    }
    if (!this.duelChoices.has(square) && this.duelChoices.size >= 2) {
      this.toast('最多只能选择两个棋子');
      return;
    }
    this.duelFocused = square;
    this.duelCollapsed = false;
    this.refreshDuelDock();
  }

  private toggleDuelDock(): void {
    this.duelCollapsed = !this.duelCollapsed;
    this.refreshDuelDock();
  }

  private confirmDuelSelection(): void {
    const selector = this.duelSelector;
    if (!selector) return;
    const result: TransformChoice[] = [...this.duelChoices.entries()].map(
      ([square, target]) => ({ square, target }),
    );
    try {
      this.game.selectTransformations(selector, result);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : '无法应用升变');
      return;
    }
    this.closeDuelDock(false);
    this.sound.play('duel');
    if (this.game.duel.phase === 'selection') {
      window.setTimeout(() => void this.handleDuelSelection(), 80);
    } else {
      this.updateGameUI();
      window.setTimeout(() => this.maybeAI(), 300);
    }
  }

  // -------------------------------------------------------------------------
  // Archive / replay
  // -------------------------------------------------------------------------

  private openLibrary(): void {
    this.pauseReplay();
    this.replayBoard?.destroy();
    this.replayBoard = null;
    this.replayGame = null;
    this.replayRecord = null;
    this.replayFrames = [];
    this.aiGeneration += 1;
    this.aiThinking = false;
    this.board?.destroy();
    this.board = null;
    this.closeModal(false);
    this.renderLibrary();
  }

  private renderLibrary(): void {
    this.screen = 'library';
    const total = this.savedRecords.length;
    const featuredCount = this.savedRecords.filter((record) => record.featured).length;
    this.root.innerHTML = `
      <div class="library-screen">
        <header class="game-topbar">
          <button class="topbar-back" id="library-back" type="button">← 首页</button>
          <div class="topbar-title">棋谱观赏</div>
          <div class="topbar-meta">
            <span class="meta-pill">${total} 份棋谱</span>
            <span class="meta-pill">内置 ${featuredCount} 份</span>
          </div>
        </header>
        <main class="library-main">
          <div class="library-head">
            <div>
              <h1>棋谱观赏</h1>
              <p class="muted">保存的对局可以回看、重命名或删除；内置 10 局困难 AI 教学棋谱。</p>
            </div>
            <div class="library-head-actions">
              <button class="ghost-btn" id="library-export" type="button">导出棋谱</button>
              <button class="ghost-btn" id="library-import" type="button">导入棋谱</button>
              <button class="ghost-btn" id="library-restore" type="button">恢复内置棋谱</button>
              <button class="primary-btn" id="library-home" type="button">返回首页</button>
            </div>
          </div>
          <input id="library-file" type="file" accept=".json,application/json" hidden />
          <div class="record-list" id="record-list"></div>
        </main>
      </div>
    `;

    this.root.querySelector<HTMLButtonElement>('#library-back')?.addEventListener('click', () => this.renderStart());
    this.root.querySelector<HTMLButtonElement>('#library-home')?.addEventListener('click', () => this.renderStart());
    this.root.querySelector<HTMLButtonElement>('#library-export')?.addEventListener('click', () => this.exportRecords());
    this.root.querySelector<HTMLButtonElement>('#library-import')?.addEventListener('click', () => {
      this.root.querySelector<HTMLInputElement>('#library-file')?.click();
    });
    this.root.querySelector<HTMLInputElement>('#library-file')?.addEventListener('change', (event) => {
      const input = event.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.importRecordFile(file);
    });
    this.root.querySelector<HTMLButtonElement>('#library-restore')?.addEventListener('click', () => {
      const restored = restoreFeaturedRecords(this.savedRecords);
      if (!restored.changed) {
        this.toast('内置棋谱已经齐全');
        return;
      }
      if (!persistSavedRecords(restored.records)) {
        this.toast('恢复失败：浏览器存储空间不足');
        return;
      }
      this.savedRecords = restored.records;
      this.renderLibrary();
      this.toast('已恢复内置棋谱');
    });

    const list = this.root.querySelector<HTMLElement>('#record-list');
    if (!list) return;
    if (!total) {
      const empty = el('div', 'record-empty');
      empty.append(
        el('div', 'record-empty-mark', '谱'),
        el('p', '', '还没有棋谱。对局结束后点「保存棋谱」，或恢复内置棋谱。'),
      );
      list.appendChild(empty);
      return;
    }

    const sorted = [...this.savedRecords].sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? 1 : -1;
      if (a.featured && b.featured) return (a.order ?? 99) - (b.order ?? 99);
      return b.createdAt.localeCompare(a.createdAt);
    });

    for (const record of sorted) {
      const item = el('article', 'record-item');
      const main = el('button', 'record-main');
      main.type = 'button';
      const titleRow = el('div', 'record-title-row');
      titleRow.appendChild(el('span', 'record-name', record.name));
      if (record.featured) titleRow.appendChild(el('span', 'record-badge', '内置'));
      const modeLabel =
        record.mode === 'ai' ? `人机 · ${DIFFICULTY_LABEL[record.difficulty]}` : '双人';
      const stamp = Number.isNaN(Date.parse(record.createdAt))
        ? record.createdAt
        : new Date(record.createdAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });
      main.append(
        titleRow,
        el(
          'span',
          'record-meta',
          `${modeLabel} · ${record.plies} 手 · ${RESULT_REASON[record.result.reason] ?? record.result.reason} · ${stamp}`,
        ),
        el(
          'span',
          `record-result ${record.result.winner === RED ? 'red' : 'black'}`,
          `${sideName(record.result.winner)}胜`,
        ),
      );
      main.addEventListener('click', () => this.openReplay(record));

      const actions = el('div', 'record-actions');
      actions.append(
        button('查看', 'mini-btn primary', () => this.openReplay(record)),
        button('重命名', 'mini-btn', () => this.renameRecord(record, () => this.renderLibrary())),
        button('删除', 'mini-btn danger', () => this.deleteRecord(record, () => this.renderLibrary())),
      );
      item.append(main, actions);
      list.appendChild(item);
    }
  }

  private exportRecords(): void {
    if (!this.savedRecords.length) {
      this.toast('没有可导出的棋谱');
      return;
    }
    const text = buildRecordBundle(this.savedRecords);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `中国象棋WTF版-棋谱-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast(`已导出 ${this.savedRecords.length} 份棋谱`);
  }

  private async importRecordFile(file: File): Promise<void> {
    if (file.size > 8 * 1024 * 1024) {
      this.showImportError('文件过大（最多 8 MB）');
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch {
      this.showImportError('无法读取文件');
      return;
    }
    let imported: SavedGameRecord[];
    try {
      imported = parseRecordBundle(text);
    } catch (error) {
      this.showImportError(error instanceof Error ? error.message : '棋谱格式不合法');
      return;
    }
    const existingNames = new Set(this.savedRecords.map((record) => record.name));
    const records = imported.map((record) => {
      let name = record.name;
      if (existingNames.has(name)) name = `${name}（导入）`;
      existingNames.add(name);
      return {
        ...record,
        id: makeRecordId(),
        name,
        featured: false,
        order: undefined,
      } as SavedGameRecord;
    });
    const next = [...records, ...this.savedRecords];
    if (!persistSavedRecords(next)) {
      this.showImportError('导入失败：浏览器存储空间不足');
      return;
    }
    this.savedRecords = next;
    this.renderLibrary();
    this.toast(`已导入 ${records.length} 份棋谱`);
  }

  private showImportError(message: string): void {
    const body = el('div', 'import-error');
    body.appendChild(el('p', '', message));
    this.openModal({
      title: '棋谱导入失败',
      body,
      dismissible: true,
      actions: [button('关闭', 'primary-btn', () => this.closeModal())],
    });
  }

  private renameRecord(record: SavedGameRecord, after?: () => void): void {
    this.pauseReplay();
    const body = el('div', 'rename-body');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.value = record.name;
    input.maxLength = 60;
    const footer = el('div', 'modal-actions');
    const save = button('保存', 'primary-btn', () => {
      const name = input.value.trim();
      if (!name) {
        this.toast('名称不能为空');
        input.focus();
        return;
      }
      record.name = name;
      if (!persistSavedRecords(this.savedRecords)) {
        this.toast('保存失败：浏览器存储空间不足');
        return;
      }
      this.closeModal(false);
      after?.();
      this.toast('已重命名');
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save.click();
    });
    footer.append(button('取消', 'ghost-btn', () => this.closeModal(false)), save);
    body.append(el('p', 'muted small', '给这份棋谱起一个方便查找的名字。'), input, footer);
    this.openModal({ title: '重命名棋谱', body, dismissible: true });
    input.focus();
    input.select();
  }

  private deleteRecord(record: SavedGameRecord, after?: () => void): void {
    this.pauseReplay();
    this.confirm('删除棋谱', `确定删除「${record.name}」？删除后可以在棋谱库点“恢复内置棋谱”找回内置棋谱。`, () => {
      const next = this.savedRecords.filter((item) => item.id !== record.id);
      if (!persistSavedRecords(next)) {
        this.toast('删除失败：浏览器存储空间不足');
        return;
      }
      this.savedRecords = next;
      this.closeModal(false);
      after?.();
      this.toast('棋谱已删除');
    });
  }

  private openReplay(record: SavedGameRecord): void {
    this.pauseReplay();
    this.replayBoard?.destroy();
    this.replayBoard = null;
    this.replayRecord = record;
    this.replayGame = new Game();
    try {
      this.replayFrames = buildReplayFrames(record);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : '棋谱无法回放');
      this.replayRecord = null;
      this.renderLibrary();
      return;
    }
    this.replayIndex = 0;
    this.screen = 'replay';
    this.renderReplay();
  }

  private renderReplay(): void {
    const record = this.replayRecord;
    if (!record) return;
    const resultLabel = RESULT_REASON[record.result.reason] ?? record.result.reason;
    this.root.innerHTML = `
      <div class="game-screen replay-screen">
        <header class="game-topbar">
          <button class="topbar-back" id="replay-back" type="button">← 棋谱库</button>
          <div class="topbar-title">棋谱观赏</div>
          <div class="topbar-meta">
            <span class="meta-pill ${record.result.winner === RED ? 'replay-red' : 'replay-black'}">${sideName(record.result.winner)}胜 · ${resultLabel}</span>
          </div>
        </header>
        <main class="game-main">
          <section class="board-column">
            <div class="board-frame">
              <canvas id="replay-canvas" aria-label="棋谱回放棋盘"></canvas>
            </div>
            <div class="board-caption" id="replay-caption"></div>
          </section>
          <aside class="side-panel">
            <div class="panel-card replay-info-card">
              <h2 id="replay-title"></h2>
              <p class="muted small" id="replay-meta"></p>
              <div class="replay-step" id="replay-step"></div>
              <div class="replay-speed-row">
                <label for="replay-speed">播放速度</label>
                <input id="replay-speed" type="range" min="2" max="15" step="1" value="${this.settings.replaySpeed}" />
                <output id="replay-speed-label">${this.settings.replaySpeed} 秒/步</output>
              </div>
              <div class="replay-controls">
                <button class="action-btn" id="replay-prev" type="button">上一步</button>
                <button class="action-btn" id="replay-next" type="button">下一步</button>
                <button class="action-btn" id="replay-auto" type="button">自动播放</button>
                <button class="action-btn" id="replay-pause" type="button">暂停</button>
              </div>
              <div class="replay-actions">
                <button class="action-btn ghost" id="replay-rename" type="button">重命名</button>
                <button class="action-btn ghost danger" id="replay-delete" type="button">删除棋谱</button>
              </div>
            </div>
            <div class="panel-card moves-card replay-moves-card">
              <div class="card-head"><span>棋谱步骤</span><span class="muted" id="replay-count"></span></div>
              <ol class="move-list replay-move-list" id="replay-list"></ol>
            </div>
          </aside>
        </main>
      </div>
    `;

    const title = this.root.querySelector<HTMLElement>('#replay-title');
    if (title) title.textContent = record.name;
    const meta = this.root.querySelector<HTMLElement>('#replay-meta');
    if (meta) {
      const stamp = Number.isNaN(Date.parse(record.createdAt))
        ? record.createdAt
        : new Date(record.createdAt).toLocaleString('zh-CN');
      const modeLabel = record.mode === 'ai' ? `人机 · ${DIFFICULTY_LABEL[record.difficulty]}` : '双人';
      meta.textContent = `${modeLabel} · ${record.plies} 手 · ${stamp}${record.featured ? ' · 内置教学棋谱' : ''}`;
    }
    const count = this.root.querySelector<HTMLElement>('#replay-count');
    if (count) count.textContent = `${Math.max(0, this.replayFrames.length - 1)} 步`;

    const list = this.root.querySelector<HTMLOListElement>('#replay-list');
    if (list) {
      this.replayFrames.forEach((frame, index) => {
        const li = el('li', `move-row replay-move-row ${frame.kind}`);
        if (index === 0) li.classList.add('start');
        li.append(
          el('span', 'ply-no', index === 0 ? '0' : String(index)),
          el('span', 'move-text', index === 0 ? '开局' : frame.label),
        );
        li.addEventListener('click', () => {
          this.pauseReplay();
          this.showReplayFrame(index);
        });
        list.appendChild(li);
      });
    }

    const canvas = this.root.querySelector<HTMLCanvasElement>('#replay-canvas');
    if (!canvas || !this.replayGame) return;
    this.replayBoard = new BoardView(this.replayGame, {
      canvas,
      onSquareClick: () => {
        // Read-only replay board.
      },
      showCoordinates: this.settings.coordinates,
    });
    this.replayBoard.setFlipped(false);

    this.root.querySelector<HTMLButtonElement>('#replay-back')?.addEventListener('click', () => this.openLibrary());
    this.root.querySelector<HTMLButtonElement>('#replay-prev')?.addEventListener('click', () => {
      this.pauseReplay();
      this.showReplayFrame(this.replayIndex - 1);
    });
    this.root.querySelector<HTMLButtonElement>('#replay-next')?.addEventListener('click', () => {
      this.pauseReplay();
      this.showReplayFrame(this.replayIndex + 1);
    });
    this.root.querySelector<HTMLButtonElement>('#replay-auto')?.addEventListener('click', () => this.startReplayAuto());
    this.root.querySelector<HTMLButtonElement>('#replay-pause')?.addEventListener('click', () => this.pauseReplay());
    this.root.querySelector<HTMLButtonElement>('#replay-rename')?.addEventListener('click', () => {
      this.pauseReplay();
      this.renameRecord(record, () => {
        const titleNode = this.root.querySelector<HTMLElement>('#replay-title');
        if (titleNode) titleNode.textContent = record.name;
      });
    });
    this.root.querySelector<HTMLButtonElement>('#replay-delete')?.addEventListener('click', () => {
      this.pauseReplay();
      this.deleteRecord(record, () => this.openLibrary());
    });

    const speed = this.root.querySelector<HTMLInputElement>('#replay-speed');
    const speedLabel = this.root.querySelector<HTMLOutputElement>('#replay-speed-label');
    speed?.addEventListener('input', () => {
      const seconds = Math.min(15, Math.max(2, Math.round(Number(speed.value) || 5)));
      this.settings.replaySpeed = seconds;
      speed.value = String(seconds);
      if (speedLabel) speedLabel.textContent = `${seconds} 秒/步`;
      this.saveSettings();
      if (this.replayTimer !== null) {
        this.pauseReplay();
        this.startReplayAuto();
      }
    });

    this.showReplayFrame(0);
  }

  private showReplayFrame(index: number): void {
    if (!this.replayGame || !this.replayFrames.length) return;
    const max = this.replayFrames.length - 1;
    this.replayIndex = Math.max(0, Math.min(max, index));
    const frame = this.replayFrames[this.replayIndex];
    this.replayGame.position = frame.position.clone();
    this.replayGame.duel = cloneDuel(frame.duel);
    this.replayGame.result = frame.result ? { ...frame.result } : null;
    this.replayGame.lastMove = frame.lastMove ? { ...frame.lastMove } : null;
    this.replayBoard?.setGame(this.replayGame);

    const step = this.root.querySelector<HTMLElement>('#replay-step');
    if (step) {
      step.textContent = `第 ${this.replayIndex} / ${max} 步`;
    }
    const caption = this.root.querySelector<HTMLElement>('#replay-caption');
    if (caption) {
      caption.textContent =
        frame.kind === 'start'
          ? '开局 · 红方先行'
          : `${frame.label}${frame.detail ? ` · ${frame.detail}` : ''}`;
    }
    this.root.querySelectorAll<HTMLElement>('.replay-move-row').forEach((row, rowIndex) => {
      row.classList.toggle('current', rowIndex === this.replayIndex);
    });
    const current = this.root.querySelector<HTMLElement>('.replay-move-row.current');
    current?.scrollIntoView({ block: 'nearest' });
    this.updateReplayButtons();
  }

  private updateReplayButtons(): void {
    const prev = this.root.querySelector<HTMLButtonElement>('#replay-prev');
    const next = this.root.querySelector<HTMLButtonElement>('#replay-next');
    const auto = this.root.querySelector<HTMLButtonElement>('#replay-auto');
    const pause = this.root.querySelector<HTMLButtonElement>('#replay-pause');
    if (!prev || !next || !auto || !pause) return;
    const last = Math.max(0, this.replayFrames.length - 1);
    const playing = this.replayTimer !== null;
    prev.disabled = this.replayIndex <= 0;
    next.disabled = this.replayIndex >= last;
    auto.disabled = playing || this.replayIndex >= last;
    pause.disabled = !playing;
  }

  private startReplayAuto(): void {
    if (this.screen !== 'replay') return;
    if (this.replayTimer !== null) return;
    if (this.replayIndex >= this.replayFrames.length - 1) return;
    this.replayTimer = window.setInterval(() => {
      if (this.screen !== 'replay' || !this.replayRecord) {
        this.pauseReplay();
        return;
      }
      if (this.replayIndex >= this.replayFrames.length - 1) {
        this.pauseReplay();
        return;
      }
      this.showReplayFrame(this.replayIndex + 1);
      if (this.replayIndex >= this.replayFrames.length - 1) this.pauseReplay();
    }, Math.max(2, Math.min(15, this.settings.replaySpeed)) * 1000);
    this.updateReplayButtons();
  }

  private pauseReplay(): void {
    if (this.replayTimer !== null) {
      window.clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.updateReplayButtons();
  }

  // -------------------------------------------------------------------------
  // Game actions
  // -------------------------------------------------------------------------

  private handleSaveRecord(): boolean {
    if (!this.game.gameOver || !this.game.result) {
      this.toast('对局结束后才能保存棋谱');
      return false;
    }
    if (this.savedCurrent) return true;
    const record: SavedGameRecord = {
      id: makeRecordId(),
      name: defaultRecordName(this.mode, this.difficulty, this.game.result),
      createdAt: new Date().toISOString(),
      mode: this.mode,
      difficulty: this.difficulty,
      humanColor: this.humanColor,
      result: { ...this.game.result },
      plies: this.game.moveRecords.length,
      events: JSON.parse(
        JSON.stringify(this.game.events),
      ) as SavedGameRecord['events'],
    };
    const next = [record, ...this.savedRecords];
    if (!persistSavedRecords(next)) {
      this.toast('保存失败：浏览器存储空间不足');
      return false;
    }
    this.savedRecords = next;
    this.savedCurrent = true;
    this.updateButtons();
    this.toast('棋谱已保存，可在首页「棋谱观赏」查看');
    return true;
  }

  private handleUndo(): void {
    if (this.aiThinking || this.game.duel.phase === 'selection') return;
    if (!this.game.canUndo()) {
      this.toast('没有可悔的棋');
      return;
    }
    this.suppressUpdates = true;
    let count = 0;
    while (count < 2 && this.game.canUndo()) {
      this.game.undo();
      count += 1;
      if (this.mode === 'pvp' || this.game.position.turn === this.humanColor) break;
    }
    this.suppressUpdates = false;
    this.selected = null;
    this.legalForSelected = [];
    this.resultShown = false;
    this.closeModal(false);
    this.updateGameUI();
    this.toast('已悔棋');
    window.setTimeout(() => this.maybeAI(), 300);
  }

  private handleNewGame(): void {
    if (this.game.moveRecords.length && !this.game.gameOver) {
      this.confirm('重新开始', '当前对局尚未结束，确定重新开始？', () => {
        this.closeModal(false);
        this.startGame(this.mode, this.humanColor, this.difficulty);
      });
      return;
    }
    this.startGame(this.mode, this.humanColor, this.difficulty);
  }

  private handleResign(): void {
    if (this.game.gameOver) return;
    const color = this.mode === 'ai' ? this.humanColor : this.game.position.turn;
    this.confirm('认输', `${sideName(color)}确定认输？`, () => {
      this.closeModal(false);
      this.game.resign(color);
    });
  }

  private handleOfferDuel(): void {
    if (!this.game.canOfferDuel()) {
      this.toast('当前不能提前进入生死斗');
      return;
    }
    if (this.mode === 'ai') {
      this.confirm(
        '提前生死斗',
        '提前进入生死斗？AI 会同意。双方各选最多两个棋子升变，随后继续对局。',
        () => {
          this.closeModal(false);
          this.game.startDuelByAgreement();
          this.sound.play('duel');
        },
      );
      return;
    }

    let redAgree = false;
    let blackAgree = false;
    const body = el('div', 'agreement-body');
    body.innerHTML = `
      <p>提前进入生死斗需要双方同意。请两位棋手分别确认。</p>
      <label class="agree-line"><input type="checkbox" id="agree-red" /> <span class="dot red"></span> 红方同意</label>
      <label class="agree-line"><input type="checkbox" id="agree-black" /> <span class="dot black"></span> 黑方同意</label>
      <p class="muted small">双方各选最多两个棋子升变，先选方先走；新子下一步不可将死。</p>
    `;
    const footer = el('div', 'modal-actions');
    const cancel = button('取消', 'ghost-btn', () => this.closeModal());
    const start = button('进入生死斗', 'primary-btn', () => {
      if (!redAgree || !blackAgree) return;
      this.closeModal(false);
      this.game.startDuelByAgreement();
      this.sound.play('duel');
    });
    start.disabled = true;
    footer.append(cancel, start);
    body.appendChild(footer);
    this.openModal({ title: '提前生死斗', body, dismissible: true });
    const red = body.querySelector<HTMLInputElement>('#agree-red');
    const black = body.querySelector<HTMLInputElement>('#agree-black');
    const sync = () => {
      redAgree = !!red?.checked;
      blackAgree = !!black?.checked;
      start.disabled = !(redAgree && blackAgree);
    };
    red?.addEventListener('change', sync);
    black?.addEventListener('change', sync);
  }

  private handleFlip(): void {
    if (this.mode === 'ai' && !this.game.gameOver) {
      this.swapSides();
      return;
    }
    this.flipped = !this.flipped;
    this.board?.setFlipped(this.flipped);
  }

  /**
   * AI mode: transfer control of both sides without touching the position or
   * the turn order. Any in-flight AI request for the old side is invalidated;
   * if the new AI side is to move, it starts thinking immediately.
   */
  private swapSides(): void {
    this.aiGeneration += 1;
    this.aiThinking = false;
    this.aiInfo = '';
    this.humanColor = this.humanColor === RED ? BLACK : RED;
    this.game.humanColor = this.humanColor;
    this.flipped = !this.flipped;
    this.board?.setFlipped(this.flipped);
    this.clearSelection();
    if (this.duelDock) this.clearDuelDock();
    this.duelModalOpen = false;
    this.duelBusy = false;
    this.updateGameUI();

    const newSide = this.humanColor === RED ? '红方' : '黑方';
    const turnOwner = this.isAI(this.game.position.turn) ? 'AI 行棋' : '你行棋';
    this.toast(`已交换执方：你现在执${newSide} · ${turnOwner}`);
    this.sound.play('click');

    if (this.game.duel.phase === 'selection') {
      window.setTimeout(() => void this.handleDuelSelection(), 120);
    } else {
      window.setTimeout(() => this.maybeAI(), 260);
    }
  }

  // -------------------------------------------------------------------------
  // Modals
  // -------------------------------------------------------------------------

  private openModal(options: {
    title: string;
    body: HTMLElement;
    actions?: HTMLElement[];
    dismissible?: boolean;
    wide?: boolean;
    extraClass?: string;
  }): ModalHandle {
    this.closeModal(false);
    const overlay = el('div', 'modal-overlay');
    const modal = el('div', `modal ${options.wide ? 'wide' : ''} ${options.extraClass ?? ''}`);
    const header = el('div', 'modal-header');
    const title = el('h2', 'modal-title', options.title);
    header.appendChild(title);
    if (options.dismissible !== false) {
      const close = button('×', 'modal-close', () => this.closeModal());
      header.appendChild(close);
    }
    const content = el('div', 'modal-body');
    content.appendChild(options.body);
    modal.append(header, content);
    if (options.actions?.length) {
      const footer = el('div', 'modal-actions');
      footer.append(...options.actions);
      modal.appendChild(footer);
    }
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.modalOpen = true;
    if (options.dismissible !== false) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) this.closeModal();
      });
    }
    this.modal = { overlay, close: () => this.closeModal() };
    return this.modal;
  }

  private closeModal(refresh = true): void {
    if (this.duelDock) this.clearDuelDock();
    if (this.modal) {
      this.modal.overlay.remove();
      this.modal = null;
    }
    this.modalOpen = false;
    this.duelModalOpen = false;
    if (refresh && this.screen === 'game') {
      this.updateGameUI();
      if (this.game.duel.phase === 'selection') {
        window.setTimeout(() => void this.handleDuelSelection(), 120);
      } else {
        window.setTimeout(() => this.maybeAI(), 300);
      }
    }
  }

  private confirm(title: string, message: string, onConfirm: () => void): void {
    const body = el('div');
    const p = el('p', '', message);
    body.appendChild(p);
    const footer = el('div', 'modal-actions');
    footer.append(
      button('取消', 'ghost-btn', () => this.closeModal()),
      button('确定', 'primary-btn', onConfirm),
    );
    body.appendChild(footer);
    this.openModal({ title, body, dismissible: true });
  }

  private showGameOver(): void {
    if (!this.game.result || this.screen !== 'game') return;
    const result = this.game.result;
    const body = el('div', 'game-over-body');
    const winner = el('div', 'game-over-winner');
    winner.innerHTML = `<span class="winner-dot ${result.winner === RED ? 'red' : 'black'}"></span>${sideName(result.winner)}获胜`;
    const reason = el('div', 'game-over-reason', result.message);
    const stats = el(
      'div',
      'game-over-stats',
      `共 ${this.game.moveRecords.length} 手 · ${
        this.game.duel.count ? `第 ${this.game.duel.count} 次生死斗` : '未进入生死斗'
      }`,
    );
    body.append(winner, reason, stats);

    const footer = el('div', 'modal-actions');
    const save = button(
      this.savedCurrent ? '棋谱已保存' : '保存棋谱',
      'primary-btn',
      () => {
        if (this.handleSaveRecord()) {
          save.textContent = '棋谱已保存';
          save.disabled = true;
        }
      },
    );
    save.disabled = this.savedCurrent;
    footer.append(
      save,
      button('棋谱库', 'ghost-btn', () => {
        if (!this.savedCurrent) this.handleSaveRecord();
        this.closeModal(false);
        this.openLibrary();
      }),
      button('查看棋盘', 'ghost-btn', () => this.closeModal()),
      button('返回首页', 'ghost-btn', () => {
        this.closeModal(false);
        this.returnHome(true);
      }),
      button('再来一局', 'ghost-btn', () => {
        this.closeModal(false);
        this.startGame(this.mode, this.humanColor, this.difficulty);
      }),
    );
    body.appendChild(footer);
    this.openModal({
      title: '对局结束',
      body,
      dismissible: true,
      extraClass: 'game-over-modal',
    });
  }

  private openOpeningGuide(): void {
    const body = el('div', 'opening-guide');
    body.innerHTML = `
      <p class="muted">推荐首着：</p>
      <ul class="opening-list">
        ${RECOMMENDED_OPENINGS.map((move) => `<li>${move}</li>`).join('')}
      </ul>
    `;
    this.openModal({
      title: '推荐首着',
      body,
      dismissible: true,
      wide: true,
      actions: [button('关闭', 'primary-btn', () => this.closeModal())],
    });
  }

  private openRules(): void {
    const body = el('div', 'rulebook-frame-wrap');
    const iframe = document.createElement('iframe');
    iframe.className = 'rulebook-frame';
    iframe.title = '中国象棋WTF版规则说明书';
    iframe.srcdoc = rulebookHtml;
    body.appendChild(iframe);
    const actions = [
      button('打印 / 保存 PDF', 'ghost-btn', () => this.printRulebook()),
      button('关闭', 'primary-btn', () => this.closeModal()),
    ];
    this.openModal({ title: '中国象棋WTF版 · 规则说明', body, actions, wide: true, extraClass: 'rulebook-modal' });
  }

  private printRulebook(): void {
    const win = window.open('', '_blank', 'width=980,height=1200');
    if (!win) {
      this.toast('浏览器拦截了打印窗口，请允许弹窗后重试');
      return;
    }
    win.document.open();
    win.document.write(rulebookHtml);
    win.document.close();
    win.focus();
    window.setTimeout(() => win.print(), 350);
  }

  private openAIHelp(): void {
    const body = el('div', 'ai-help-body');
    body.innerHTML = `
      <h3>AI 是怎么下棋的</h3>
      <p>AI 使用 Alpha-Beta 搜索 + 迭代加深 + 静态搜索，评估函数综合子力、位置、王安全、最后一个非王子、升变潜力与生死斗变身价值。</p>
      <p>人机模式点击“翻转棋盘”会交换你与 AI 的执方，棋盘翻面，当前行棋顺序不变；如果轮到 AI，AI 会立即继续。</p>
      <p>搜索会把妖/巫的蓄力状态当作合法着法约束：蓄力中的妖/巫不会走隔两子吃子；AI 也会计算“再等一轮”的代价。</p>
      <table>
        <tr><th>难度</th><th>搜索</th><th>时间</th><th>特点</th></tr>
        <tr><td>简单</td><td>深度 2</td><td>约 0.35 秒</td><td>会犯错，适合新手</td></tr>
        <tr><td>普通</td><td>深度 5（1.4 秒上限）</td><td>约 1.4 秒</td><td>不做近似同分随机，优先选搜索最佳着</td></tr>
        <tr><td>困难</td><td>迭代加深至深度 6</td><td>约 2.4 秒</td><td>更强的战术组合，仍保证不超时</td></tr>
        <tr><td>专家</td><td>迭代加深至深度 7</td><td>约 6 秒</td><td>更强的搜索与杀手着法排序，适合复盘和推演</td></tr>
      </table>
      <h3>生死斗选子</h3>
      <p>AI 会枚举最多两个升变组合，评估子力收益、王安全、是否保留最后一个卫/奴、以及是否会被对方立即将死。后选时能看到对手的选择并针对性应对。</p>
      <h3>已知限制</h3>
      <p>长将/长捉采用简化判定；AI 不是大师水平，但不会走出非法着法。若浏览器不支持 Web Worker，会自动降级到主线程计算。</p>
    `;
    this.openModal({ title: 'AI 说明', body, dismissible: true, wide: true });
  }

  private openSettings(): void {
    const body = el('div', 'settings-body');
    const soundLabel = el('label', 'setting-line');
    const soundInput = document.createElement('input');
    soundInput.type = 'checkbox';
    soundInput.checked = this.settings.sound;
    soundLabel.append(soundInput, el('span', '', '音效'));
    soundInput.addEventListener('change', () => {
      this.settings.sound = soundInput.checked;
      this.sound.setEnabled(soundInput.checked);
      this.saveSettings();
    });

    const coordLabel = el('label', 'setting-line');
    const coordInput = document.createElement('input');
    coordInput.type = 'checkbox';
    coordInput.checked = this.settings.coordinates;
    coordLabel.append(coordInput, el('span', '', '棋盘坐标'));
    coordInput.addEventListener('change', () => {
      this.settings.coordinates = coordInput.checked;
      this.board?.setShowCoordinates(coordInput.checked);
      this.saveSettings();
    });

    const reset = button('重置设置', 'ghost-btn', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.sound.setEnabled(this.settings.sound);
      this.board?.setShowCoordinates(this.settings.coordinates);
      this.saveSettings();
      this.closeModal();
    });

    body.append(soundLabel, coordLabel, el('p', 'muted small', '设置会自动保存到本机浏览器。'));
    const footer = el('div', 'modal-actions');
    footer.append(reset, button('关闭', 'primary-btn', () => this.closeModal()));
    body.appendChild(footer);
    this.openModal({ title: '设置', body, dismissible: true });
  }

  private openAbout(): void {
    const body = el('div', 'about-body');
    body.innerHTML = `
      <div class="about-mark">毒</div>
      <h3>中国象棋WTF版</h3>
      <p class="about-version">v${VERSION} · 规则已冻结</p>
      <p>开发者：<strong>剧毒术士（离谱暗封剑）</strong></p>
      <p>虎、豹、象、奴、妖、狼、霸；坦、骑、牛、卫、巫、勇、王。一个把象棋规则彻底改写、但仍然可以认真下完的奇幻变体。</p>
      <p class="muted">本地离线运行 · 无后端 · 无外部资源 · 支持双人与人机对战</p>
      <p class="muted small">棋盘、棋子与音效均由程序生成。规则说明书可在游戏内打开，也可打印为 PDF。</p>
      <p class="muted small">开源协议：MIT License · 源代码与规则书可在项目仓库中获取。</p>
    `;
    const footer = el('div', 'modal-actions');
    footer.append(
      button('规则说明', 'ghost-btn', () => {
        this.closeModal();
        this.openRules();
      }),
      button('关闭', 'primary-btn', () => this.closeModal()),
    );
    body.appendChild(footer);
    this.openModal({ title: '关于', body, dismissible: true });
  }

  private saveSettings(): void {
    try {
      localStorage.setItem('wtf-chess-settings', JSON.stringify(this.settings));
    } catch {
      // Ignore storage errors.
    }
  }

  // -------------------------------------------------------------------------
  // Navigation / feedback
  // -------------------------------------------------------------------------

  private returnHome(force = false): void {
    if (!force && this.game.moveRecords.length && !this.game.gameOver) {
      this.confirm('返回首页', '当前对局尚未结束，确定返回首页？', () => {
        this.closeModal(false);
        this.returnHome(true);
      });
      return;
    }
    this.aiGeneration += 1;
    this.aiThinking = false;
    this.screen = 'start';
    this.board?.destroy();
    this.board = null;
    this.closeModal(false);
    this.renderStart();
  }

  private toast(message: string): void {
    const node = el('div', 'toast', message);
    document.body.appendChild(node);
    window.setTimeout(() => node.classList.add('show'), 20);
    window.setTimeout(() => {
      node.classList.remove('show');
      window.setTimeout(() => node.remove(), 220);
    }, 2_100);
  }
}
