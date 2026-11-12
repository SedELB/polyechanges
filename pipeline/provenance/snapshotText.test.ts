import { describe, expect, it } from 'vitest';
import { makePdf } from './testPdf.js';
import { decodeText, findCode, findQuote, findQuoteSpans, isSubstantialQuote, linesListing, snapshotText } from './snapshotText.js';

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
      ['un', 'deux', 'a | b', 'x', 'y', 't', 'd'],
    ]);
  });

  it('extrait une page par page de PDF', async () => {
    const pages = await snapshotText(makePdf([['Calendar  2026', 'Fall begins: September 7'], ['Spring begins: February 1']]), 'application/pdf');
    expect(pages).toEqual([['Calendar 2026', 'Fall begins: September 7'], ['Spring begins: February 1']]);
  });
});

describe('lignes de tableau', () => {
  it('met une rangée sur une ligne, cellules vides ignorées', async () => {
    const html =
      '<table><tr><td>08-30(Mon)</td><td>Fall semester classes begin</td></tr><tr><td></td><td>Holiday</td></tr></table>';
    expect(await snapshotText(Buffer.from(html), 'text/html')).toEqual([['08-30(Mon) | Fall semester classes begin', 'Holiday']]);
  });
  it('aplatit le contenu bloc d’une cellule', async () => {
    const html = '<table><tr><td><p>a</p><p>b</p></td><td>c<br>d</td><th><ul><li>e</li><li>f</li></ul></th></tr></table>';
    expect(await snapshotText(Buffer.from(html), 'text/html')).toEqual([['a b | c d | e f']]);
  });
  it('findQuote retrouve un extrait de cellule et la date avec son événement', async () => {
    const pages = await snapshotText(
      Buffer.from('<p>x</p><table><tbody><tr><td>08-30(Mon)</td><td>Classes begin</td></tr></tbody></table>'),
      'text/html',
    );
    expect(findQuote(pages, 'Classes begin')).toEqual([{ page: 1, line: 2 }]);
    expect(findQuote(pages, '08-30(Mon) | Classes begin')).toEqual([{ page: 1, line: 2 }]);
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

describe('extraits sur plusieurs lignes', () => {
  it('un extrait d’une ligne garde son résultat', () => {
    expect(findQuote([['a', 'Classes begin here', 'b']], 'Classes begin')).toEqual([{ page: 1, line: 2 }]);
  });
  it('trouve un extrait réparti sur deux lignes, avec la première ligne pour position', () => {
    const pages = [['Calendar', '03-03', 'Classes begin', 'March']];
    expect(findQuote(pages, '03-03 Classes begin')).toEqual([{ page: 1, line: 2 }]);
    expect(findQuoteSpans(pages, '03-03 Classes begin')).toEqual([{ page: 1, line: 2, lines: 2 }]);
  });
  it('trouve un extrait réparti sur trois lignes', () => {
    const pages = [['x', '03-03', 'Classes begin', 'March', 'y']];
    expect(findQuoteSpans(pages, '03-03 Classes begin March')).toEqual([{ page: 1, line: 2, lines: 3 }]);
  });
  it('préfère une correspondance sur une ligne à une sur plusieurs', () => {
    const pages = [['03-03', 'Classes begin', 'later', '03-03 Classes begin']];
    expect(findQuoteSpans(pages, '03-03 Classes begin')).toEqual([{ page: 1, line: 4, lines: 1 }]);
  });
  it('préfère deux lignes à trois', () => {
    expect(findQuoteSpans([['a', 'b', 'c', 'a b', 'c']], 'a b c')).toEqual([{ page: 1, line: 4, lines: 2 }]);
    expect(findQuoteSpans([['a', 'b c', 'd']], 'a b c d')).toEqual([{ page: 1, line: 1, lines: 3 }]);
  });
  it('ne franchit jamais une limite de page', () => {
    expect(findQuote([['x', '03-03'], ['Classes begin', 'y']], '03-03 Classes begin')).toEqual([]);
  });
  it('ne regarde pas au-delà de trois lignes', () => {
    expect(findQuote([['aaa', 'bbb', 'ccc', 'ddd']], 'aaa bbb ccc ddd')).toEqual([]);
  });
  it('findCode reste sur une seule ligne', () => {
    expect(findCode([['Curriculum', 'CS 101']], 'Curriculum CS101')).toEqual([]);
  });
});

describe('texte brut', () => {
  const txt = Buffer.from('﻿Course list 2026\r\nCSIE1212\tData  Structures\tEnglish\n\nCSIE2136 Algorithm Design\n');

  it('une ligne de texte = une ligne extraite, sur une seule page', async () => {
    expect(await snapshotText(txt, 'text/plain')).toEqual([
      ['Course list 2026', 'CSIE1212 Data Structures English', '', 'CSIE2136 Algorithm Design'],
    ]);
    expect(await snapshotText(Buffer.from(''), 'text/plain; charset=utf-8')).toEqual([[]]);
  });

  it('findQuoteSpans et findCode y retrouvent extraits et codes', async () => {
    const pages = await snapshotText(txt, 'text/plain');
    expect(findQuoteSpans(pages, 'CSIE1212 Data Structures')).toEqual([{ page: 1, line: 2, lines: 1 }]);
    expect(findQuoteSpans(pages, 'Course list 2026 CSIE1212')).toEqual([{ page: 1, line: 1, lines: 2 }]);
    expect(findCode(pages, 'CSIE2136')).toEqual([{ page: 1, line: 4 }]);
  });
});

describe('texte brut UTF-16', () => {
  it('lit un .txt « Texte Unicode » (UTF-16 LE avec marque d’ordre)', async () => {
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('CSIE1212\tData Structures\r\nCSIE2136\n', 'utf16le')]);
    expect(await snapshotText(body, 'text/plain')).toEqual([['CSIE1212 Data Structures', 'CSIE2136']]);
    expect(decodeText(body)).toBe('CSIE1212\tData Structures\r\nCSIE2136\n');
    expect(decodeText(Buffer.from('é'))).toBe('é');
  });
});
