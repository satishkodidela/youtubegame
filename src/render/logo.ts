import { FONT, STAR_ON, UI_DARK } from './theme';

// The game logo, shared by the title screen and the store art (src/editor/promo.ts).

function outlined(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size: number, fill: string): void {
  ctx.font = `700 ${Math.round(size)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = 'rgba(31,42,68,0.35)';
  ctx.strokeText(str, x, y + size * 0.09);
  ctx.fillStyle = 'rgba(31,42,68,0.35)';
  ctx.fillText(str, x, y + size * 0.09);
  ctx.strokeStyle = UI_DARK;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}

/**
 * "DRAW TO HOLE" centred on (cx, cy), with letters `size` pixels tall, and an ink swoosh with a ball
 * below. `ink` colours the swoosh (the player's chosen ink on the title screen).
 */
export function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ink = UI_DARK): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.05);
  outlined(ctx, 'DRAW', 0, -size * 0.55, size, '#ffffff');
  outlined(ctx, 'TO HOLE', 0, size * 0.52, size * 1.08, STAR_ON);
  ctx.restore();

  // An ink swoosh under the logo, like a drawn ramp; the ball has just rolled up the far end.
  ctx.font = `700 ${Math.round(size * 1.08)}px ${FONT}`;
  const lw = ctx.measureText('TO HOLE').width;
  const x0 = cx - lw * 0.42;
  const x1 = cx + lw * 0.36;
  const uy = cy + size * 1.5;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(5, size * 0.13);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, uy - size * 0.14);
  ctx.quadraticCurveTo(cx - lw * 0.05, uy + size * 0.24, x1, uy - size * 0.02);
  ctx.stroke();
  const br = size * 0.17;
  const bx = x1 + br * 0.15;
  const by = uy - size * 0.02 - br - ctx.lineWidth * 0.45;
  const g = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#c9d3e6');
  ctx.fillStyle = g;
  ctx.strokeStyle = UI_DARK;
  ctx.lineWidth = Math.max(2, br * 0.22);
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
