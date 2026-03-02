import puppeteer from 'puppeteer';

/**
 * Launch Puppeteer, render the given HTML, and write a PDF to disk.
 *
 * @param {string} html       Full HTML document string
 * @param {object} opts
 * @param {string} opts.outputPath  Absolute path for the output PDF
 */
export async function generatePdf(html, { outputPath }) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Give Google Fonts up to 30 s to load; fail gracefully if offline
    page.setDefaultNavigationTimeout(30_000);

    await page.setContent(html, { waitUntil: 'networkidle0' }).catch((err) => {
      if (err.message.includes('net::ERR_') || err.message.includes('timeout')) {
        console.warn('[warn] Network timeout during page load (Google Fonts offline?). Continuing anyway…');
      } else {
        throw err;
      }
    });

    await page.emulateMediaType('print');

    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
  } finally {
    await browser.close();
  }
}
