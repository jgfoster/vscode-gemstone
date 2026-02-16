import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';

const libraryPath = process.env.GCI_LIBRARY_PATH;
if (!libraryPath) {
  console.error('GCI_LIBRARY_PATH environment variable is not set. Skipping GCI tests.');
  console.error('Set it to the path of your libgcits library, e.g.:');
  console.error('  GCI_LIBRARY_PATH=/path/to/libgcits-3.7.2-64.dylib npm run test:gci');
  process.exit(1);
}

describe('GciTsVersion', () => {
  const gci = new GciLibrary(libraryPath);

  afterAll(() => {
    gci.close();
  });

  it('returns product id 3 (GemStone/S 64)', () => {
    const { product } = gci.GciTsVersion();
    expect(product).toBe(3);
  });

  it('returns a version string matching x.y.z pattern', () => {
    const { version } = gci.GciTsVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns a version string consistent with the library filename', () => {
    const { version } = gci.GciTsVersion();
    const filenameMatch = libraryPath.match(/libgcits-([\d.]+)-64\./);
    if (filenameMatch) {
      expect(version).toContain(filenameMatch[1]);
    }
  });
});
