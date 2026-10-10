// Renders a real A4 report through @napi-rs/canvas. Run with `npm run test:pdf`
// after `npm install --no-save @napi-rs/canvas`.
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect, it} from 'vitest';
import {iso, today} from '../../src/lib/dates';
import {makeImagePdf, renderReportCanvas} from '../../src/lib/reportPdf';
import {buildReport, reportStages} from '../../src/lib/reports';
import {seed} from './seed';

it('generates a one-page A4 PDF and rejects overflowing reports', async () => {
  const {createCanvas} = await import('@napi-rs/canvas' as string);
  const options = {createCanvas: () => createCanvas(1, 1)};
  const client = seed()[99];
  const sample = buildReport(client, {
    stage: reportStages[0],
    from: '2026-09-01',
    to: iso(today),
    done: 'Демонстрационный пример: согласованы направления поступления и список университетов. Для каждой программы определены требования и следующие действия.',
    next: 'Подготовить резюме и черновик мотивационного письма. Затем согласовать документы и проверить комплектность каждой заявки.',
    clientAction: 'До 10 октября прислать актуальное резюме и перевод транскрипта. Подтвердить ознакомление с отчётом ответным сообщением.',
    appIds: client.apps.map(a => a.id),
  });
  const output = renderReportCanvas(sample, 10, options);
  expect(output.fits, `height ${output.usedHeight}`).toBe(true);
  const pdf = makeImagePdf(output.canvas.toBuffer('image/jpeg'), output.canvas.width, output.canvas.height);
  const dir = path.join(import.meta.dirname, '../../output/pdf');
  mkdirSync(dir, {recursive: true});
  writeFileSync(path.join(dir, 'stage-report-example.pdf'), pdf);
  sample.done = 'Длинный текст '.repeat(1500);
  expect(renderReportCanvas(sample, 9, options).fits).toBe(false);
});
