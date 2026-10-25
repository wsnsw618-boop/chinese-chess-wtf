import { Game } from '../game/state';
import {
  BOARD_SIZE,
  Color,
  Move,
  PieceType,
  RED,
  fileOf,
  pieceName,
  rankOf,
  square,
} from '../game/types';
import { isInCheck } from '../game/moves';
import { findKing } from '../game/board';

const CELL = 64;
const MARGIN = 54;
const W = 8 * CELL + MARGIN * 2;
const H = 9 * CELL + MARGIN * 2;

export interface BoardViewOptions {
  canvas: HTMLCanvasElement;
  onSquareClick: (sq: number) => void;
  showCoordinates: boolean;
}

export class BoardView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private selected: number | null = null;
  private legal: Move[] = [];
  private flipped = false;
  private hover: number | null = null;
  private showCoordinates: boolean;
  private onSquareClick: (sq: number) => void;
  private dpr = 1;

  constructor(game: Game, options: BoardViewOptions) {
    this.game = game;
    this.canvas = options.canvas;
    this.onSquareClick = options.onSquareClick;
    this.showCoordinates = options.showCoordinates;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;

    this.resize();
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.render();
  }

  destroy(): void {
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  setGame(game: Game): void {
    this.game = game;
    this.legal = [];
    this.selected = null;
    this.render();
  }

  setSelected(sq: number | null, legal: Move[] = []): void {
    this.selected = sq;
    this.legal = legal;
    this.render();
  }

  setFlipped(flipped: boolean): void {
    this.flipped = flipped;
    this.render();
  }

  setShowCoordinates(show: boolean): void {
    this.showCoordinates = show;
    this.render();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.aspectRatio = `${W} / ${H}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  private screenXY(file: number, rank: number): [number, number] {
    const f = this.flipped ? 8 - file : file;
    const r = this.flipped ? rank : 9 - rank;
    return [MARGIN + f * CELL, MARGIN + r * CELL];
  }

  private squareScreenXY(sq: number): [number, number] {
    return this.screenXY(fileOf(sq), rankOf(sq));
  }

  private handleClick = (event: MouseEvent): void => {
    const sq = this.eventSquare(event);
    if (sq >= 0) this.onSquareClick(sq);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const sq = this.eventSquare(event);
    if (sq !== this.hover) {
      this.hover = sq;
      this.render();
    }
  };

  private handlePointerLeave = (): void => {
    this.hover = null;
    this.render();
  };

  private eventSquare(event: MouseEvent | PointerEvent): number {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = ((event.clientX - rect.left) / rect.width) * W;
    const y = ((event.clientY - rect.top) / rect.height) * H;
    let file = Math.round((x - MARGIN) / CELL);
    let rank = Math.round((y - MARGIN) / CELL);
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return -1;
    const sx = MARGIN + file * CELL;
    const sy = MARGIN + rank * CELL;
    if (Math.hypot(x - sx, y - sy) > CELL * 0.48) return -1;
    if (this.flipped) {
      file = 8 - file;
    } else {
      rank = 9 - rank;
    }
    return square(file, rank);
  }

  render(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    this.drawBoard();
    this.drawMoveMarkers();
    this.drawPieces();
    this.drawLegalMarkers();
    this.drawCheck();
    this.drawLabels();
  }

  private drawBoard(): void {
    const { ctx } = this;
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#ecd6ad');
    bg.addColorStop(0.5, '#e2c48f');
    bg.addColorStop(1, '#d2ab72');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle grain.
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#5b381b';
    for (let i = 0; i < 46; i++) {
      const y = 10 + i * 14.5;
      ctx.beginPath();
      ctx.moveTo(0, y + Math.sin(i) * 4);
      ctx.bezierCurveTo(W * 0.3, y - 3, W * 0.7, y + 3, W, y);
      ctx.stroke();
    }
    ctx.restore();

    // Outer frame.
    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(61, 36, 17, 0.85)';
    ctx.strokeRect(13, 13, W - 26, H - 26);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 239, 201, 0.8)';
    ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(86, 50, 22, 0.55)';
    ctx.strokeRect(26, 26, W - 52, H - 52);
    ctx.restore();

    const left = MARGIN;
    const top = MARGIN;
    const right = MARGIN + 8 * CELL;
    const bottom = MARGIN + 9 * CELL;

    ctx.save();
    ctx.strokeStyle = '#6e4a28';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'square';

    // Horizontal lines.
    for (let r = 0; r < 10; r++) {
      ctx.beginPath();
      ctx.moveTo(left, top + r * CELL);
      ctx.lineTo(right, top + r * CELL);
      ctx.stroke();
    }

    // Vertical lines, broken at the river except the outer files.
    for (let f = 0; f < 9; f++) {
      const x = left + f * CELL;
      if (f === 0 || f === 8) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + 4 * CELL);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, top + 5 * CELL);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    // Palace diagonals.
    const palace = (rankTop: number) => {
      const y0 = top + rankTop * CELL;
      const y2 = y0 + 2 * CELL;
      const xd = left + 3 * CELL;
      const xf = left + 5 * CELL;
      ctx.beginPath();
      ctx.moveTo(xd, y0);
      ctx.lineTo(xf, y2);
      ctx.moveTo(xf, y0);
      ctx.lineTo(xd, y2);
      ctx.stroke();
    };
    palace(0);
    palace(7);

    // River gap lines.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(110, 74, 40, 0.55)';
    ctx.beginPath();
    ctx.moveTo(left, top + 4 * CELL);
    ctx.lineTo(left, top + 5 * CELL);
    ctx.moveTo(right, top + 4 * CELL);
    ctx.lineTo(right, top + 5 * CELL);
    ctx.stroke();

    // River text.
    ctx.save();
    ctx.fillStyle = 'rgba(99, 60, 27, 0.72)';
    ctx.font = '500 28px "KaiTi", "STKaiti", "SimSun", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const riverY = top + 4.5 * CELL;
    ctx.fillText('楚  河', left + 2.25 * CELL, riverY);
    ctx.fillText('汉  界', left + 6.75 * CELL, riverY);
    ctx.restore();

    ctx.restore();
  }

  private drawLabels(): void {
    if (!this.showCoordinates) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = 'rgba(73, 43, 18, 0.72)';
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let file = 0; file < 9; file++) {
      const f = this.flipped ? 8 - file : file;
      const x = MARGIN + f * CELL;
      ctx.fillText(String.fromCharCode(97 + file), x, 25);
      ctx.fillText(String.fromCharCode(97 + file), x, H - 25);
    }
    for (let rank = 0; rank < 10; rank++) {
      const r = this.flipped ? rank : 9 - rank;
      const y = MARGIN + r * CELL;
      ctx.fillText(String(rank + 1), 25, y);
      ctx.fillText(String(rank + 1), W - 25, y);
    }
    ctx.restore();
  }

  private drawMoveMarkers(): void {
    const move = this.game.lastMove;
    if (!move) return;
    const { ctx } = this;
    for (const [sq, alpha] of [
      [move.from, 0.16],
      [move.to, 0.22],
    ] as Array<[number, number]>) {
      const [x, y] = this.squareScreenXY(sq);
      ctx.save();
      ctx.fillStyle = `rgba(163, 112, 37, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPieces(): void {
    const { ctx } = this;
    const game = this.game;
    const isRestriction = game.duel.phase === 'restriction';
    const newIds = new Set(game.duel.newlyTransformedIds);
    const checkedColor = isInCheck(game.position, game.position.turn)
      ? game.position.turn
      : null;
    const checkedKing = checkedColor ? findKing(game.position, checkedColor) : -1;

    for (let sq = 0; sq < BOARD_SIZE; sq++) {
      const piece = game.position.board[sq];
      if (!piece) continue;
      const [x, y] = this.squareScreenXY(sq);
      const red = piece > 0;
      const isSelected = this.selected === sq;
      const isChecked = checkedKing === sq;
      const isNew = isRestriction && newIds.has(game.position.ids[sq]);

      ctx.save();
      if (isSelected) {
        ctx.shadowColor = 'rgba(255, 197, 74, 0.95)';
        ctx.shadowBlur = 18;
      } else if (isNew) {
        ctx.shadowColor = 'rgba(220, 168, 75, 0.9)';
        ctx.shadowBlur = 13;
      } else {
        ctx.shadowColor = 'rgba(54, 30, 12, 0.45)';
        ctx.shadowBlur = 7;
        ctx.shadowOffsetY = 3;
      }

      const radius = CELL * 0.42;
      const gradient = ctx.createRadialGradient(
        x - radius * 0.35,
        y - radius * 0.45,
        radius * 0.15,
        x,
        y,
        radius,
      );
      gradient.addColorStop(0, '#fff8e7');
      gradient.addColorStop(0.7, '#f1dfbd');
      gradient.addColorStop(1, '#d9bd8e');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.lineWidth = isSelected ? 3.2 : 2.3;
      ctx.strokeStyle = red ? '#a72b20' : '#24201c';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 1;
      ctx.strokeStyle = red ? 'rgba(167, 43, 32, 0.45)' : 'rgba(36, 32, 28, 0.4)';
      ctx.beginPath();
      ctx.arc(x, y, radius - 4.5, 0, Math.PI * 2);
      ctx.stroke();

      if (isSelected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffd36a';
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isChecked) {
        const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 180);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(220, 52, 42, ${pulse})`;
        ctx.beginPath();
        ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (isNew) {
        ctx.fillStyle = 'rgba(218, 157, 44, 0.9)';
        ctx.beginPath();
        ctx.arc(x + radius * 0.7, y - radius * 0.7, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = red ? '#a3261b' : '#1c1915';
      ctx.font = '700 33px "KaiTi", "STKaiti", "SimSun", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pieceName(piece), x, y + 1.5);
      ctx.restore();
    }
  }

  private drawLegalMarkers(): void {
    if (!this.legal.length) return;
    const { ctx } = this;
    const seen = new Set<number>();
    for (const move of this.legal) {
      if (seen.has(move.to)) continue;
      seen.add(move.to);
      const [x, y] = this.squareScreenXY(move.to);
      const occupied = this.game.position.board[move.to] !== 0;
      ctx.save();
      if (move.kind !== 'normal') {
        ctx.strokeStyle = 'rgba(176, 119, 30, 0.9)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(176, 119, 30, 0.95)';
        ctx.font = '10px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(move.kind === 'swapGuard' ? '换' : '吃', x, y + 4);
      } else if (occupied) {
        ctx.strokeStyle = 'rgba(190, 51, 36, 0.85)';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(x, y, CELL * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(86, 74, 52, 0.55)';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawCheck(): void {
    // The check ring is drawn as part of drawPieces to keep it under the glyph.
    // This method exists for a future pulse animation hook.
  }
}
