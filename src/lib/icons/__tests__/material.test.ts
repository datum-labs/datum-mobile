import { execSync } from 'node:child_process';

import { MATERIAL_SYMBOLS } from '../material';

/**
 * Every SF Symbol the app names as an icon needs a Material Symbol for
 * Android, or it renders as the fallback circle.
 */
describe('MATERIAL_SYMBOLS', () => {
  it('covers every SF Symbol used in icon props', () => {
    const out = execSync(
      `grep -rhoE "<Icon name=\\"[a-z0-9.]+\\"|(icon|systemImage)=\\"[a-z0-9.]+\\"|(icon|systemImage): '[a-z0-9.]+'|toolbarIcon\\('[a-z0-9.]+'\\)" app src || true`,
      { cwd: `${__dirname}/../../../..`, encoding: 'utf8' }
    );
    const used = new Set(
      out
        .split('\n')
        .map((line) => line.match(/["'(]([a-z0-9.]+)["')]+$/)?.[1])
        .filter((name): name is string => !!name)
    );
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((name) => !(name in MATERIAL_SYMBOLS));
    expect(missing).toEqual([]);
  });
});
