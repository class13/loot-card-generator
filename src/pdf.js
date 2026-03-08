import puppeteer from 'puppeteer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Launch Puppeteer, render the given HTML, and write a PDF to disk.
 *
 * @param {string} html       Full HTML document string
 * @param {object} opts
 * @param {string} opts.outputPath  Absolute path for the output PDF
 */
export async function generatePdf(html, { outputPath }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-cards-chrome-'));
  const htmlPath = path.join(userDataDir, 'document.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--allow-file-access-from-files',
    ],
  });

  try {
    const page = await browser.newPage();

    // Give Google Fonts up to 30 s to load; fail gracefully if offline
    page.setDefaultNavigationTimeout(30_000);

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' }).catch((err) => {
      if (err.message.includes('net::ERR_') || err.message.includes('timeout')) {
        console.warn('[warn] Network timeout during page load (Google Fonts offline?). Continuing anyway…');
      } else {
        throw err;
      }
    });

    await page.emulateMediaType('print');

    try {
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      });
    } catch (err) {
      if (String(err?.message || '').includes('Target closed')) {
        throw new Error(
          'Chromium process exited during PDF generation (possible memory pressure from large images).',
        );
      }
      throw err;
    }
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}
