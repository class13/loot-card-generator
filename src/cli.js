import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { loadYaml } from './loader.js';
import { renderHtml } from './renderer.js';
import { generatePdf } from './pdf.js';

/**
 * Expand cards based on optional `quantity` field (default: 1).
 *
 * @param {object[]} cards
 * @returns {object[]}
 */
function expandCardsByQuantity(cards) {
  return cards.flatMap((card) => {
    const quantity = card.quantity ?? 1;
    return Array.from({ length: quantity }, () => ({ ...card }));
  });
}

export function run() {
  program
    .name('loot-cards')
    .description('Generate print-ready D&D loot card PDFs from YAML files')
    .version('1.0.0')
    .argument('<input>', 'YAML file path')
    .option('-o, --output <path>', 'Output PDF path', './loot-cards.pdf')
    .option('-t, --theme <path>', 'Custom CSS override file')
    .option('-c, --columns <n>', 'Cards per row', (v) => parseInt(v, 10), 3)
    .option('-r, --rows <n>', 'Rows per page', (v) => parseInt(v, 10), 3)
    .option('--no-bleed', 'Disable bleed marks')
    .option('--auto-icon', 'Auto-find icons from game-icons.net for cards without an explicit icon field')
    .option('--debug-html <path>', 'Write intermediate HTML for browser inspection')
    .option('--open', 'Open PDF after generation')
    .action(async (input, options) => {
      try {
        // ── 1. Load & validate YAML ────────────────────────────
        console.log(chalk.cyan('⚙  Loading') + ' ' + input);
        const { cards, yamlDir } = loadYaml(input);
        console.log(chalk.green(`✔  Loaded ${cards.length} card(s)`));
        const expandedCards = expandCardsByQuantity(cards);
        if (expandedCards.length !== cards.length) {
          console.log(
            chalk.green(
              `✔  Expanded to ${expandedCards.length} card(s) after applying quantity values`,
            ),
          );
        }

        // ── 2. Render HTML ─────────────────────────────────────
        console.log(chalk.cyan('⚙  Rendering HTML…'));
        const html = await renderHtml(expandedCards, {
          yamlDir,
          columns: options.columns,
          rows: options.rows,
          customCssPath: options.theme,
          bleed: options.bleed,
          autoIcon: options.autoIcon,
        });

        // ── 3. Optional: dump HTML for debugging ───────────────
        if (options.debugHtml) {
          const debugPath = path.resolve(options.debugHtml);
          fs.writeFileSync(debugPath, html, 'utf8');
          console.log(chalk.yellow(`⚙  Debug HTML written to: ${debugPath}`));
        }

        // ── 4. Generate PDF ────────────────────────────────────
        const outputPath = path.resolve(options.output);
        console.log(chalk.cyan('⚙  Generating PDF…'));
        await generatePdf(html, { outputPath });
        console.log(chalk.green(`✔  PDF saved to: ${outputPath}`));

        // ── 5. Open PDF ────────────────────────────────────────
        if (options.open) {
          const { default: open } = await import('open').catch(() => ({
            default: null,
          }));
          if (open) {
            await open(outputPath);
          } else {
            // Fallback: macOS / Linux / Windows
            const { execSync } = await import('child_process');
            const cmd =
              process.platform === 'darwin'
                ? `open "${outputPath}"`
                : process.platform === 'win32'
                ? `start "" "${outputPath}"`
                : `xdg-open "${outputPath}"`;
            execSync(cmd);
          }
        }
      } catch (err) {
        console.error(err)
        console.error(chalk.red('\n✖  Error: ') + err.message);
        process.exit(1);
      }
    });

  program.parse();
}
