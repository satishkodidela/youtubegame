// Button icons. Every control has one; labels, where there are any, come from game/strings.ts.

export type IconName =
  | 'play'
  | 'retry'
  | 'pause'
  | 'grid'
  | 'home'
  | 'lock'
  | 'next'
  | 'back'
  | 'left'
  | 'right'
  | 'hint'
  | 'soundOn'
  | 'soundOff'
  | 'skip'
  | 'calendar'
  | 'palette'
  | 'flame'
  | 'check'
  | 'trophy'
  | 'drop';

export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.48;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, outline?: string): void {
  starPath(ctx, cx, cy, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(1, r * 0.14);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string): void {
  const u = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (name) {
    case 'play':
    case 'next': {
      ctx.beginPath();
      ctx.moveTo(-u * 0.55, -u * 0.75);
      ctx.lineTo(u * 0.8, 0);
      ctx.lineTo(-u * 0.55, u * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (name === 'next') {
        ctx.beginPath();
        ctx.moveTo(u * 0.95, -u * 0.75);
        ctx.lineTo(u * 0.95, u * 0.75);
        ctx.stroke();
      }
      break;
    }
    case 'retry': {
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.68, -Math.PI * 0.35, Math.PI * 1.45);
      ctx.stroke();
      const a = -Math.PI * 0.35;
      const ex = Math.cos(a) * u * 0.68;
      const ey = Math.sin(a) * u * 0.68;
      ctx.beginPath();
      ctx.moveTo(ex + u * 0.42, ey - u * 0.08);
      ctx.lineTo(ex + u * 0.02, ey + u * 0.36);
      ctx.lineTo(ex - u * 0.16, ey - u * 0.26);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pause': {
      ctx.fillRect(-u * 0.55, -u * 0.7, u * 0.38, u * 1.4);
      ctx.fillRect(u * 0.17, -u * 0.7, u * 0.38, u * 1.4);
      break;
    }
    case 'grid': {
      const g = u * 0.62;
      const c = u * 0.5;
      for (const ox of [-1, 1]) for (const oy of [-1, 1]) roundRectFill(ctx, ox * g * 0.6 - c / 2, oy * g * 0.6 - c / 2, c, c, c * 0.25);
      break;
    }
    case 'home': {
      ctx.beginPath();
      ctx.moveTo(-u * 0.8, -u * 0.05);
      ctx.lineTo(0, -u * 0.8);
      ctx.lineTo(u * 0.8, -u * 0.05);
      ctx.stroke();
      roundRectFill(ctx, -u * 0.55, -u * 0.15, u * 1.1, u * 0.85, u * 0.1);
      break;
    }
    case 'lock': {
      ctx.lineWidth = size * 0.12;
      ctx.beginPath();
      ctx.arc(0, -u * 0.2, u * 0.36, Math.PI, 0);
      ctx.stroke();
      roundRectFill(ctx, -u * 0.58, -u * 0.22, u * 1.16, u * 0.92, u * 0.16);
      break;
    }
    case 'back':
    case 'left':
    case 'right': {
      const d = name === 'right' ? 1 : -1;
      ctx.lineWidth = size * 0.16;
      ctx.beginPath();
      ctx.moveTo(-d * u * 0.3, -u * 0.6);
      ctx.lineTo(d * u * 0.35, 0);
      ctx.lineTo(-d * u * 0.3, u * 0.6);
      ctx.stroke();
      break;
    }
    case 'hint': {
      ctx.beginPath();
      ctx.arc(0, -u * 0.18, u * 0.5, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(u * 0.22, u * 0.45);
      ctx.lineTo(-u * 0.22, u * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-u * 0.22, u * 0.55, u * 0.44, u * 0.14);
      ctx.fillRect(-u * 0.14, u * 0.74, u * 0.28, u * 0.1);
      break;
    }
    case 'skip': {
      // Two chevrons: "move on".
      ctx.lineWidth = size * 0.15;
      for (const ox of [-0.42, 0.18]) {
        ctx.beginPath();
        ctx.moveTo(ox * u, -u * 0.6);
        ctx.lineTo((ox + 0.5) * u, 0);
        ctx.lineTo(ox * u, u * 0.6);
        ctx.stroke();
      }
      break;
    }
    case 'calendar': {
      roundRectFill(ctx, -u * 0.8, -u * 0.6, u * 1.6, u * 1.4, u * 0.18);
      ctx.fillStyle = color;
      ctx.lineWidth = size * 0.1;
      ctx.beginPath();
      ctx.moveTo(-u * 0.45, -u * 0.85);
      ctx.lineTo(-u * 0.45, -u * 0.4);
      ctx.moveTo(u * 0.45, -u * 0.85);
      ctx.lineTo(u * 0.45, -u * 0.4);
      ctx.stroke();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(-u * 0.65, -u * 0.2, u * 1.3, u * 0.85);
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'palette': {
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      for (const [px, py] of [
        [-0.35, -0.3],
        [0.1, -0.45],
        [0.45, -0.05],
        [-0.4, 0.25],
      ]) {
        ctx.beginPath();
        ctx.arc(px * u, py * u, u * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(u * 0.45, u * 0.5, u * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'flame': {
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.85);
      ctx.quadraticCurveTo(u * 0.75, -u * 0.1, u * 0.6, u * 0.35);
      ctx.quadraticCurveTo(u * 0.45, u * 0.85, 0, u * 0.85);
      ctx.quadraticCurveTo(-u * 0.6, u * 0.85, -u * 0.6, u * 0.3);
      ctx.quadraticCurveTo(-u * 0.6, -u * 0.05, -u * 0.25, -u * 0.25);
      ctx.quadraticCurveTo(-u * 0.1, -u * 0.5, 0, -u * 0.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'check': {
      ctx.lineWidth = size * 0.16;
      ctx.beginPath();
      ctx.moveTo(-u * 0.6, u * 0.05);
      ctx.lineTo(-u * 0.15, u * 0.5);
      ctx.lineTo(u * 0.65, -u * 0.5);
      ctx.stroke();
      break;
    }
    case 'trophy': {
      ctx.beginPath();
      ctx.moveTo(-u * 0.5, -u * 0.8);
      ctx.lineTo(u * 0.5, -u * 0.8);
      ctx.quadraticCurveTo(u * 0.5, u * 0.1, 0, u * 0.25);
      ctx.quadraticCurveTo(-u * 0.5, u * 0.1, -u * 0.5, -u * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = size * 0.1;
      ctx.beginPath();
      ctx.arc(-u * 0.6, -u * 0.4, u * 0.28, Math.PI * 0.5, Math.PI * 1.5);
      ctx.moveTo(u * 0.6, -u * 0.4);
      ctx.arc(u * 0.6, -u * 0.4, u * 0.28, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      ctx.fillRect(-u * 0.1, u * 0.2, u * 0.2, u * 0.4);
      roundRectFill(ctx, -u * 0.45, u * 0.55, u * 0.9, u * 0.25, u * 0.08);
      break;
    }
    case 'drop': {
      // An ink drop: the gold-ink medal.
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.85);
      ctx.quadraticCurveTo(u * 0.75, u * 0.05, u * 0.6, u * 0.35);
      ctx.arc(0, u * 0.3, u * 0.6, -Math.PI * 0.1, Math.PI * 1.1);
      ctx.quadraticCurveTo(-u * 0.75, u * 0.05, 0, -u * 0.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'soundOn':
    case 'soundOff': {
      ctx.beginPath();
      ctx.moveTo(-u * 0.75, -u * 0.25);
      ctx.lineTo(-u * 0.4, -u * 0.25);
      ctx.lineTo(0, -u * 0.65);
      ctx.lineTo(0, u * 0.65);
      ctx.lineTo(-u * 0.4, u * 0.25);
      ctx.lineTo(-u * 0.75, u * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = size * 0.1;
      if (name === 'soundOn') {
        ctx.beginPath();
        ctx.arc(u * 0.05, 0, u * 0.4, -0.8, 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(u * 0.05, 0, u * 0.72, -0.8, 0.8);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(u * 0.25, -u * 0.35);
        ctx.lineTo(u * 0.85, u * 0.35);
        ctx.moveTo(u * 0.85, -u * 0.35);
        ctx.lineTo(u * 0.25, u * 0.35);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
