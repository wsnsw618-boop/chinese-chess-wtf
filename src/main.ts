import './styles.css';
import { App } from './ui/app';
import { Position } from './game/board';
import { BLACK, PieceType, RED, makePiece, parseCoord } from './game/types';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root');
}

const app = new App(root);

// Small debug surface used by the browser smoke tests and for scenario setup.
// It does not affect normal play.
(window as unknown as { __WTF_DEBUG__: unknown }).__WTF_DEBUG__ = {
  app,
  game: (app as unknown as { game: unknown }).game,
  Position,
  makePiece,
  parseCoord,
  PieceType,
  RED,
  BLACK,
};
