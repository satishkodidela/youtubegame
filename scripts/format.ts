import type { WorldDef } from '../src/levels/types';

// Writes world JSON in a diff-friendly layout: one level field per line, one item per line.
export function formatWorld(world: WorldDef): string {
  const lines: string[] = [];
  lines.push('{');
  lines.push(`  "id": ${JSON.stringify(world.id)},`);
  lines.push(`  "name": ${JSON.stringify(world.name)},`);
  lines.push('  "levels": [');
  world.levels.forEach((lv, i) => {
    const fields: string[] = [];
    fields.push(`      "id": ${JSON.stringify(lv.id)}`);
    fields.push(`      "balls": ${JSON.stringify(lv.balls)}`);
    fields.push(`      "holes": ${JSON.stringify(lv.holes)}`);
    fields.push(`      "ink": ${lv.ink}`);
    fields.push(`      "stars": ${JSON.stringify(lv.stars)}`);
    if (lv.items.length) fields.push(`      "items": [\n${lv.items.map((it) => `        ${JSON.stringify(it)}`).join(',\n')}\n      ]`);
    else fields.push('      "items": []');
    fields.push(`      "hint": ${JSON.stringify(lv.hint)}`);
    lines.push('    {');
    lines.push(fields.join(',\n'));
    lines.push(i < world.levels.length - 1 ? '    },' : '    }');
  });
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n') + '\n';
}
