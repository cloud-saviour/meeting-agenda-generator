import { Injectable, inject } from '@angular/core';
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, ImageRun,
  AlignmentType, BorderStyle, HeightRule, ShadingType, TableLayoutType,
  VerticalAlign, WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import { AgendaItem, AgendaSnapshot, CommitteeMember, Speaker } from '../models/agenda.models';
import { computeAgendaTimeline } from '../utils/agenda-timeline';
import { APP_LOCALE } from '../../../core/utils/locale';
import { RoleDefinitionService } from '../../../core/services/role-definition.service';
import { CommitteeRoleDefinitionService } from './committee-role-definition.service';

// ── Layout constants (all sums = CONTENT_W = 10546) ──────────────────────────
const CONTENT_W       = 10546;
const HEADER_LEFT_W   = 2450;
const HEADER_CENTER_W = 6500;
const HEADER_RIGHT_W  = 1596;
const INFO_WIDTHS     = [2500, 3100, 2400, 2546];
const TIME_W          = 900;
const ACTIVITY_W      = 4300;
const PERSON_W        = CONTENT_W - TIME_W - ACTIVITY_W;
const SPK_WIDTHS      = [1900, 1200, 1400, 3900, 2146];
const EVAL_WIDTHS     = [2200, 1400, 4700, 2246];
const FOOTER_WIDTHS   = [2250, 2050, 1150, 2250, 1750, 1096];

const NO_BORDER  = { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' };
const BLK_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const NO_BORDERS  = { top: NO_BORDER,  bottom: NO_BORDER,  left: NO_BORDER,  right: NO_BORDER  };
const BLK_BORDERS = { top: BLK_BORDER, bottom: BLK_BORDER, left: BLK_BORDER, right: BLK_BORDER };

// ── Validation helpers ────────────────────────────────────────────────────────
function assertWidths(name: string, widths: number[], expected: number) {
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum !== expected) {
    throw new Error(`DOCX layout: ${name} widths sum ${sum} ≠ ${expected}`);
  }
}

function scaledImageSize(ow: number, oh: number, targetW: number) {
  return { width: targetW, height: Math.round(oh * targetW / ow) };
}

// ── Primitive builders ────────────────────────────────────────────────────────
function dxNoSpace(extra: Record<string, unknown> = {}) {
  return { before: 0, after: 0, line: 240, lineRule: 'auto' as const, ...extra };
}

function dxPara(runs: (TextRun | ImageRun)[], opts: Record<string, unknown> = {}) {
  return new Paragraph({ spacing: dxNoSpace(), ...opts, children: Array.isArray(runs) ? runs : [runs] });
}

type CellBorders = typeof NO_BORDERS | typeof BLK_BORDERS;

function dxCell(children: (Paragraph | Table)[], opts: {
  width: number;
  borders?: CellBorders;
  vAlign?: typeof VerticalAlign.TOP | typeof VerticalAlign.CENTER | typeof VerticalAlign.BOTTOM;
  shading?: Record<string, unknown>;
  margins?: { top: number; bottom: number; left: number; right: number };
}) {
  const { width, borders = NO_BORDERS, vAlign = VerticalAlign.TOP, shading, margins } = opts;
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    borders,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: vAlign,
    ...(shading ? { shading } : {}),
    margins: margins ?? { top: 40, bottom: 40, left: 60, right: 60 },
  });
}

function dxRow(cells: TableCell[], opts: Record<string, unknown> = {}) {
  return new TableRow({ children: cells, ...opts });
}

function dxTable(rows: TableRow[], opts: { width?: number; borders?: CellBorders; columnWidths?: number[] } = {}) {
  const { width = CONTENT_W, borders = NO_BORDERS, columnWidths } = opts;
  if (columnWidths) assertWidths('table', columnWidths, width);
  return new Table({
    rows,
    width: { size: width, type: WidthType.DXA },
    borders,
    layout: TableLayoutType.FIXED,
    ...(columnWidths ? { columnWidths } : {}),
  });
}

// ── Section builders ──────────────────────────────────────────────────────────

async function buildHeader(leftBuf: ArrayBuffer, leftDims: {w:number;h:number},
                           rightBuf: ArrayBuffer, rightDims: {w:number;h:number},
                           d: AgendaSnapshot) {
  assertWidths('HEADER', [HEADER_LEFT_W, HEADER_CENTER_W, HEADER_RIGHT_W], CONTENT_W);
  const leftPx  = scaledImageSize(leftDims.w,  leftDims.h,  150);
  const rightPx = scaledImageSize(rightDims.w, rightDims.h,  82);

  const leftCell = new TableCell({
    width: { size: HEADER_LEFT_W, type: WidthType.DXA },
    borders: NO_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [dxPara([new ImageRun({ data: leftBuf, transformation: leftPx, type: 'png' })])],
  });

  const centerCell = new TableCell({
    width: { size: HEADER_CENTER_W, type: WidthType.DXA },
    borders: NO_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      dxPara([new TextRun({ text: d.club || '', font: 'Georgia', size: 25, bold: true, color: '9B2F1F' })], {
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D8B56A', space: 2 } },
      }),
      dxPara([new TextRun({ text: d.sub || '',  font: 'Georgia', size: 18, bold: true, color: 'C89000' })], { alignment: AlignmentType.CENTER }),
      dxPara([new TextRun({ text: d.addr || '', font: 'Georgia', size: 18, bold: true, color: 'C89000' })], { alignment: AlignmentType.CENTER }),
      dxPara([new TextRun({ text: '' })]),
      dxPara([new TextRun({ text: 'MEETING AGENDA', font: 'Georgia', size: 19, bold: true, color: '000000' })], { alignment: AlignmentType.CENTER }),
    ],
  });

  const rightCell = new TableCell({
    width: { size: HEADER_RIGHT_W, type: WidthType.DXA },
    borders: NO_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [dxPara([new ImageRun({ data: rightBuf, transformation: rightPx, type: 'png' })], { alignment: AlignmentType.RIGHT })],
  });

  return new Table({
    rows: [new TableRow({ children: [leftCell, centerCell, rightCell] })],
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: NO_BORDERS,
    layout: TableLayoutType.FIXED,
    columnWidths: [HEADER_LEFT_W, HEADER_CENTER_W, HEADER_RIGHT_W],
  });
}

function buildDivider() {
  const bar = (h: number, fill: string) => dxTable([
    dxRow([dxCell([dxPara([new TextRun({ text: '' })])], {
      width: CONTENT_W,
      borders: NO_BORDERS,
      shading: { fill, type: ShadingType.CLEAR, color: fill },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })], { height: { value: h, rule: HeightRule.EXACT } }),
  ], { columnWidths: [CONTENT_W] });
  return [bar(36, 'CE3C17'), bar(18, 'FFFFFF'), bar(18, 'CE3C17')];
}

function buildInfoBoxes(d: AgendaSnapshot) {
  assertWidths('INFO_WIDTHS', INFO_WIDTHS, CONTENT_W);
  const arrFmt = (d.arr || '18:00').replace(':', 'h');
  const stFmt  = (d.st  || '18:15').replace(':', 'h');
  const dateStr = d.date
    ? new Date(d.date + 'T00:00:00').toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  function infoBox(lines: { text: string; bold?: boolean; color?: string; size?: number }[], outerW: number) {
    const OM = 40;
    const innerW = outerW - OM * 2;
    const children = lines.map(({ text, bold, color, size }) =>
      dxPara([new TextRun({ text, bold: !!bold, italics: true, font: 'Arial', size: size ?? 16, color: color ?? '000000' })],
        { alignment: AlignmentType.CENTER })
    );
    const inner = new Table({
      width: { size: innerW, type: WidthType.DXA },
      columnWidths: [innerW],
      layout: TableLayoutType.FIXED,
      borders: BLK_BORDERS,
      rows: [dxRow([dxCell(children, {
        width: innerW, borders: BLK_BORDERS, vAlign: VerticalAlign.CENTER,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
      })], { height: { value: 560, rule: HeightRule.ATLEAST } })],
    });
    return new TableCell({
      width: { size: outerW, type: WidthType.DXA },
      borders: NO_BORDERS,
      margins: { top: 0, bottom: 0, left: OM, right: OM },
      children: [inner],
    });
  }

  const boxes = [
    infoBox([{ text: 'EMPOWERING PEOPLE', bold: true, size: 14 }, { text: `Meeting ${d.no || ''}`, bold: true, color: 'D6451E', size: 15 }], INFO_WIDTHS[0]),
    infoBox([{ text: 'THEME OF THE MEETING:', bold: true, size: 14 }, { text: `"${d.theme || '—'}"`, bold: true, color: 'D6451E', size: 15 }], INFO_WIDTHS[1]),
    infoBox([{ text: 'WORD OF THE DAY:', bold: true, color: 'D6451E', size: 14 }, { text: `"${d.word || '—'}"`, bold: true, color: 'D6451E', size: 15 }], INFO_WIDTHS[2]),
    infoBox([{ text: dateStr, bold: true, size: 17 }, { text: `${arrFmt} for ${stFmt}`, bold: true, color: 'D6451E', size: 15 }], INFO_WIDTHS[3]),
  ];

  return new Table({
    rows: [new TableRow({ children: boxes })],
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: INFO_WIDTHS,
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
  });
}

function buildMission(d: AgendaSnapshot) {
  return [
    dxPara([new TextRun({ text: '' })], { spacing: { before: 180, after: 40 } }),
    dxPara([new TextRun({ text: 'OUR MISSION', font: 'Arial', size: 20, bold: true, italics: true, color: 'D6451E' })],
      { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
    dxPara([new TextRun({ text: d.mission || '', font: 'Arial', size: 15, bold: true, italics: true })],
      { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 40 } }),
    dxPara([new TextRun({ text: `Please contact ${d.vpe || ''} if you are unable to fulfil your commitment.`, font: 'Arial', size: 14, italics: true, color: 'FF0000' })],
      { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 } }),
  ];
}

function buildAgendaBody(items: AgendaItem[], spks: Speaker[], d: AgendaSnapshot, roleLabelById: Map<string, string>) {
  assertWidths('AGENDA', [TIME_W, ACTIVITY_W, PERSON_W], CONTENT_W);
  const timeline = computeAgendaTimeline(items, spks, d.st || '18:15');

  function personRuns(item: { roleId?: string; roleVisible?: boolean; person?: string; customRoleLabel?: string | null }) {
    const custom = item.customRoleLabel?.trim();
    const role = item.roleVisible !== false ? (custom || roleLabelById.get(item.roleId ?? '') || '') : '', name = item.person || '';
    const runs: TextRun[] = [];
    if (role) runs.push(new TextRun({ text: role + (name ? ': ' : ''), font: 'Arial', size: 15, bold: true, italics: true }));
    if (name) runs.push(new TextRun({ text: name, font: 'Arial', size: 15, italics: true }));
    return runs.length ? runs : [new TextRun({ text: '' })];
  }

  function agRow(timeStr: string, title: string, pRuns: TextRun[]) {
    return dxRow([
      dxCell([dxPara([new TextRun({ text: timeStr, font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() })], { width: TIME_W,     vAlign: VerticalAlign.TOP }),
      dxCell([dxPara([new TextRun({ text: title,   font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() })], { width: ACTIVITY_W, vAlign: VerticalAlign.TOP }),
      dxCell([dxPara(pRuns, { spacing: dxNoSpace() })],                                                                    { width: PERSON_W,   vAlign: VerticalAlign.TOP }),
    ], { cantSplit: true });
  }

  const sections: (Table | Paragraph)[] = [];
  let rowBuf: TableRow[] = [];
  const flush = () => {
    if (rowBuf.length) {
      sections.push(dxTable(rowBuf, { columnWidths: [TIME_W, ACTIVITY_W, PERSON_W] }));
      rowBuf = [];
    }
  };

  items.forEach((item, i) => {
    const entry = timeline[i];
    switch (item.type) {
      case 'row':
      case 'recess': {
        rowBuf.push(agRow(entry.time!, item.title || '', personRuns(item as { roleId?: string; roleVisible?: boolean; person?: string; customRoleLabel?: string | null })));
        break;
      }
      case 'dual': {
        const a = item.items?.[0] || {};
        const b = item.items?.[1] || {};
        rowBuf.push(dxRow([
          dxCell([dxPara([new TextRun({ text: entry.timeA!, font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() }),
                  dxPara([new TextRun({ text: entry.timeB!, font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() })], { width: TIME_W,     vAlign: VerticalAlign.TOP }),
          dxCell([dxPara([new TextRun({ text: a.title || '', font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() }),
                  dxPara([new TextRun({ text: b.title || '', font: 'Arial', size: 15, italics: true })], { spacing: dxNoSpace() })], { width: ACTIVITY_W, vAlign: VerticalAlign.TOP }),
          dxCell([dxPara(personRuns(a), { spacing: dxNoSpace() }),
                  dxPara(personRuns(b), { spacing: dxNoSpace() })],                                      { width: PERSON_W,   vAlign: VerticalAlign.TOP }),
        ], { cantSplit: true }));
        break;
      }
      case 'speakers': {
        flush();
        if (spks.length) sections.push(buildSpeakersTable(spks, roleLabelById));
        break;
      }
      case 'evaluators': {
        flush();
        if (spks.length) sections.push(buildEvaluatorsTable(spks, roleLabelById));
        break;
      }
    }
  });
  flush();
  return sections;
}

function buildDataTable<T>(
  headers: string[],
  widths: number[],
  rows: T[],
  cellValues: (row: T) => string[]
) {
  assertWidths('DATA_TABLE', widths, CONTENT_W);
  const hdr = (t: string) => new TextRun({ text: t, font: 'Arial', size: 13, bold: true, italics: true });
  const bdy = (t: string) => new TextRun({ text: t, font: 'Arial', size: 14, italics: true });
  const hC  = (t: string, w: number) => dxCell([dxPara([hdr(t)], { spacing: dxNoSpace() })], { width: w, borders: BLK_BORDERS, shading: { fill: 'E0E0E0', type: ShadingType.CLEAR }, margins: { top: 30, bottom: 30, left: 50, right: 50 } });
  const bC  = (t: string, w: number) => dxCell([dxPara([bdy(t)], { spacing: dxNoSpace() })], { width: w, borders: BLK_BORDERS, margins: { top: 30, bottom: 30, left: 50, right: 50 } });
  return dxTable([
    dxRow(headers.map((h, i) => hC(h, widths[i])), { cantSplit: true, tableHeader: true }),
    ...rows.map((row) => dxRow(cellValues(row).map((v, i) => bC(v, widths[i])), { cantSplit: true })),
  ], { columnWidths: widths });
}

function evaluatorCell(s: Speaker, roleLabelById: Map<string, string>): string {
  const label = s.roleVisible !== false ? (roleLabelById.get(s.roleId ?? '') ?? '') : '';
  const name = s.evaluator || '';
  if (label && name) return `${label}: ${name}`;
  return label || name || '—';
}

function buildSpeakersTable(spks: Speaker[], roleLabelById: Map<string, string>) {
  return buildDataTable(['Speaker', 'Level', 'Time', 'Title', 'Evaluator'], SPK_WIDTHS, spks,
    (s) => [s.name || '—', s.level || '—', `${s.timeLo}-${s.timeHi} mins`, s.title || '—', evaluatorCell(s, roleLabelById)]);
}

function buildEvaluatorsTable(spks: Speaker[], roleLabelById: Map<string, string>) {
  return buildDataTable(['Evaluator', 'Time', 'Title', 'Speaker'], EVAL_WIDTHS, spks,
    (s) => [evaluatorCell(s, roleLabelById), '2–4 mins', s.title || '—', s.name || '—']);
}

function buildMeetingNotes(d: AgendaSnapshot) {
  const items = [
    d.hotSeat   && { label: 'Hot seat',        value: d.hotSeat   },
    d.reserve   && { label: 'Reserve Speaker', value: d.reserve   },
    d.apologies && { label: 'Apologies',       value: d.apologies },
  ].filter(Boolean) as { label: string; value: string }[];
  if (!items.length) return [];
  return [
    dxPara([new TextRun({ text: '' })], { spacing: { before: 80, after: 0 } }),
    ...items.map(({ label, value }) => dxPara([
      new TextRun({ text: label + ': ', font: 'Arial', size: 15, bold: true, italics: true }),
      new TextRun({ text: value,        font: 'Arial', size: 15, italics: true }),
    ], { spacing: { before: 30, after: 30 } })),
  ];
}

function buildCommitteeFooter(cmt: CommitteeMember[], d: AgendaSnapshot, roleLabelById: Map<string, string>) {
  assertWidths('FOOTER_WIDTHS', FOOTER_WIDTHS, CONTENT_W);
  const S = 12;
  const cR = (text: string, bold?: boolean, color?: string, italic?: boolean) =>
    new TextRun({ text, font: 'Arial', size: S, bold: !!bold, italics: !!italic, color: color ?? '000000' });
  const cC = (runs: TextRun[], w: number, center = false) =>
    dxCell([dxPara(Array.isArray(runs) ? runs : [runs], { spacing: dxNoSpace(), alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT })],
      { width: w, borders: BLK_BORDERS, margins: { top: 20, bottom: 20, left: 40, right: 40 } });

  const cmtRow = (a: CommitteeMember | undefined, b: CommitteeMember | undefined) => {
    const half = (m: CommitteeMember | undefined, base: number): TableCell[] => m
      ? [cC([cR(`${roleLabelById.get(m.roleId) ?? ''}: `, true), cR(m.name || '')], FOOTER_WIDTHS[base]), cC([cR(m.email || '')], FOOTER_WIDTHS[base + 1]), cC([cR(m.phone || '')], FOOTER_WIDTHS[base + 2])]
      : [cC([cR('')], FOOTER_WIDTHS[base]), cC([cR('')], FOOTER_WIDTHS[base + 1]), cC([cR('')], FOOTER_WIDTHS[base + 2])];
    return dxRow([...half(a, 0), ...half(b, 3)], { cantSplit: true, height: { value: 220, rule: HeightRule.ATLEAST } });
  };

  const treas = cmt[6];
  const row4 = dxRow([
    cC([cR(`${(treas && roleLabelById.get(treas.roleId)) || 'Treasurer'}: `, true), cR(treas?.name || '')], FOOTER_WIDTHS[0]),
    cC([cR(treas?.email || '')], FOOTER_WIDTHS[1]),
    cC([cR(treas?.phone || '')], FOOTER_WIDTHS[2]),
    cC([cR('For more information visit:', true, 'CE3C17', true)], FOOTER_WIDTHS[3]),
    cC([cR(d.web || '', false, '0000CC', true)], FOOTER_WIDTHS[4], true),
    cC([cR('')], FOOTER_WIDTHS[5]),
  ], { cantSplit: true, height: { value: 220, rule: HeightRule.ATLEAST } });

  const fbRuns = d.fb ? [
    new TextRun({ text: 'Join our Facebook group: ', font: 'Arial', size: 13, color: 'CE3C17' }),
    new TextRun({ text: d.fb,                        font: 'Arial', size: 13, bold: true, italics: true, color: 'CE3C17' }),
    new TextRun({ text: ' for regular updates!',     font: 'Arial', size: 13, color: 'CE3C17' }),
  ] : [];

  return [
    dxPara([new TextRun({ text: '' })], { spacing: { before: 60, after: 40 } }),
    dxPara([new TextRun({ text: `Executive Committee:  ${d.period || ''}`, font: 'Arial', size: 15, bold: true, italics: true, color: 'CE3C17' })],
      { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 } }),
    dxTable([cmtRow(cmt[0], cmt[1]), cmtRow(cmt[2], cmt[3]), cmtRow(cmt[4], cmt[5]), row4], { columnWidths: FOOTER_WIDTHS }),
    ...(fbRuns.length ? [dxPara(fbRuns, { alignment: AlignmentType.CENTER, spacing: { before: 60, after: 0 } })] : []),
  ];
}

// ── Image helpers (browser fetch) ─────────────────────────────────────────────
async function fetchBuffer(src: string): Promise<ArrayBuffer> {
  if (src.startsWith('data:')) {
    const base64 = src.split(',')[1];
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }
  const res = await fetch(src);
  return res.arrayBuffer();
}

async function getImageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 200, h: 100 });
    img.src = src;
  });
}

// ── Main service ──────────────────────────────────────────────────────────────
@Injectable({ providedIn: 'root' })
export class DocxService {
  private readonly roleDefs = inject(RoleDefinitionService);
  private readonly committeeRoleDefs = inject(CommitteeRoleDefinitionService);

  async generate(snapshot: AgendaSnapshot, fileName: string): Promise<void> {
    const roleLabelById = new Map([...this.roleDefs.all(), ...this.committeeRoleDefs.all()].map((r) => [r.id, r.label]));
    const logoLeft  = snapshot.logoLeft  ?? 'logo.png';
    const logoRight = snapshot.logoRight ?? 'crown.png';

    const [leftBuf, rightBuf, leftDims, rightDims] = await Promise.all([
      fetchBuffer(logoLeft),
      fetchBuffer(logoRight),
      getImageDims(logoLeft),
      getImageDims(logoRight),
    ]);

    const children = [
      await buildHeader(leftBuf, leftDims, rightBuf, rightDims, snapshot),
      ...buildDivider(),
      dxPara([new TextRun({ text: '' })], { spacing: { before: 60, after: 60 } }),
      buildInfoBoxes(snapshot),
      ...buildMission(snapshot),
      ...buildAgendaBody(snapshot.agItems, snapshot.spks, snapshot, roleLabelById),
      ...buildMeetingNotes(snapshot),
      ...buildCommitteeFooter(snapshot.cmt, snapshot, roleLabelById),
    ];

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 16 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 280, bottom: 220, left: 680, right: 680 } } },
        children,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const sig  = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (sig[0] !== 0x50 || sig[1] !== 0x4B) throw new Error('Output is not a valid DOCX file.');
    saveAs(blob, fileName + '.docx');
  }
}
