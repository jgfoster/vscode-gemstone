import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const keybindings: Array<{
  command: string;
  key: string;
  mac: string;
  when: string;
}> = pkg.contributes.keybindings;

describe('keybindings', () => {
  it('should all use the ctrl+; chord prefix (Windows/Linux)', () => {
    for (const kb of keybindings) {
      expect(kb.key, `${kb.command} has unexpected key: "${kb.key}"`).toMatch(
        /^ctrl\+; [a-z]$/,
      );
    }
  });

  it('should all use the cmd+; chord prefix (macOS)', () => {
    for (const kb of keybindings) {
      expect(kb.mac, `${kb.command} has unexpected mac key: "${kb.mac}"`).toMatch(
        /^cmd\+; [a-z]$/,
      );
    }
  });

  it('should have matching second keys on both platforms', () => {
    for (const kb of keybindings) {
      const winKey = kb.key.split(' ')[1];
      const macKey = kb.mac.split(' ')[1];
      expect(winKey).toBe(macKey);
    }
  });

  it('should have no duplicate second keys', () => {
    const secondKeys = keybindings.map((kb) => kb.key.split(' ')[1]);
    expect(new Set(secondKeys).size).toBe(secondKeys.length);
  });

  it('should map to expected commands', () => {
    const expected: Record<string, string> = {
      d: 'gemstone.displayIt',
      e: 'gemstone.executeIt',
      i: 'gemstone.inspectIt',
      b: 'gemstone.openBrowser',
      c: 'gemstone.findClass',
      m: 'gemstone.findMethod',
    };

    for (const kb of keybindings) {
      const letter = kb.mac.split(' ')[1];
      expect(expected[letter]).toBe(kb.command);
    }
  });

  it('should require active session for all bindings', () => {
    for (const kb of keybindings) {
      expect(kb.when).toContain('gemstone.hasActiveSession');
    }
  });

  it('should gate editor commands on editorTextFocus and !executing', () => {
    const editorCommands = ['gemstone.displayIt', 'gemstone.executeIt', 'gemstone.inspectIt'];
    for (const kb of keybindings) {
      if (editorCommands.includes(kb.command)) {
        expect(kb.when).toContain('editorTextFocus');
        expect(kb.when).toContain('!gemstone.executing');
      }
    }
  });
});
