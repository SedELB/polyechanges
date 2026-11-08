import { describe, expect, it } from 'vitest';
import { makePdf } from './testPdf.js';
import { findCode, findQuote, isSubstantialQuote, linesListing, snapshotText } from './snapshotText.js';

describe('snapshotText', () => {
  it('extrait les lignes d’une page HTML', async () => {
    const html =
      '<html><body><h1>Academic Calendar</h1><ul><li>Fall&nbsp;semester  begins: <b>September 7, 2026</b></li><li>Final exams end: January 8, 2027</li></ul></body></html>';
    expect(await snapshotText(Buffer.from(html), 'text/html')).toEqual([
      ['Academic Calendar', 'Fall semester begins: September 7, 2026', 'Final exams end: January 8, 2027'],
    ]);
  });

  it('coupe aux br, aux cellules et aux blocs, retire les lignes vides et ignore script et style', async () => {
    const html =
      '<body><script>var a = 1;</script><style>p{}</style><p>un<br>deux</p><table><tr><td>a</td><th>b</th></tr></table><div>x<div>y</div></div><dl><dt>t</dt><dd>d</dd></dl><p>  </p><p>&nbsp;</p></body>';
    expect(await snapshotText(Buffer.from(html), 'text/html; charset=utf-8')).toEqual([
      ['un', 'deux', 'a', 'b', 'x', 'y', 't', 'd'],
    ]);
  });

  it('extrait une page par page de PDF', async () => {
    const pages = await snapshotText(makePdf([['Calendar  2026', 'Fall begins: September 7'], ['Spring begins: February 1']]), 'application/pdf');
    expect(pages).toEqual([['Calendar 2026', 'Fall begins: September 7'], ['Spring begins: February 1']]);
  });
});

describe('findQuote', () => {
  const pages = [['Academic Calendar', 'Fall semester begins: September 7, 2026'], ['Fall semester begins: September 7, 2026 (late)']];
  it('renvoie chaque position, après la même normalisation', () => {
    expect(findQuote(pages, 'Fall\u00a0semester   begins: September 7, 2026')).toEqual([
      { page: 1, line: 2 },
      { page: 2, line: 1 },
    ]);
    expect(findQuote(pages, 'absent')).toEqual([]);
  });
  it('findCode ignore les espaces du code', () => {
    expect(findCode([['Curriculum Number 901 10040']], '90110040')).toEqual([{ page: 1, line: 1 }]);
  });
  it('findCode exige un mot entier', () => {
    expect(findCode([['CS1010 Intro', 'CS101 Data Structures']], 'CS101')).toEqual([{ page: 1, line: 2 }]);
    expect(findCode([['XCS101', 'Code: CS101.', 'CS 101 bis']], 'CS101')).toEqual([{ page: 1, line: 2 }, { page: 1, line: 3 }]);
  });
  it('refuse les extraits trop courts', () => {
    for (const q of ['2', 'Fall', '   ', 'a b', 'Fall   2']) expect(isSubstantialQuote(q), q).toBe(false);
    expect(isSubstantialQuote('Fall semester begins: September 7, 2026')).toBe(true);
  });
  it('liste les lignes avec leur position', () => {
    expect(linesListing(pages)).toBe(
      'p1:l1 Academic Calendar\np1:l2 Fall semester begins: September 7, 2026\np2:l1 Fall semester begins: September 7, 2026 (late)\n',
    );
  });
});
