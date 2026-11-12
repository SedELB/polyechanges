import { describe, expect, it, vi } from 'vitest';
import { main } from './xlsToTxt.js';

describe('saved:xls-to-txt', () => {
  it('sans argument ou avec un autre type de fichier : usage et marche à suivre sans Excel', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(String(m)));
    expect(main([])).toBe(1);
    expect(main(['page.html'])).toBe(1);
    spy.mockRestore();
    expect(errors[0]).toMatch(/Usage : npm run saved:xls-to-txt -- <fichier\.xls>/);
    expect(errors[0]).toMatch(/LibreOffice/);
    expect(errors[1]).toMatch(/LibreOffice/);
  });

  it('fichier introuvable : le dit, sans lancer Excel', () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(String(m)));
    expect(main(['data/saved/inexistant/absent.xls'])).toBe(1);
    spy.mockRestore();
    expect(errors[0]).toMatch(/Fichier introuvable/);
  });
});
