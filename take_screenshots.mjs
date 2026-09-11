import puppeteer from '../course-gallery/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXE = "C:/Users/Administrator/.cache/puppeteer/chrome-headless-shell/win64-150.0.7871.24/chrome-headless-shell-win64/chrome-headless-shell.exe";
const URL = "http://127.0.0.1:3000/";

async function run() {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader"]
  });

  // 1. Desktop Screenshot
  const desktopPage = await browser.newPage();
  await desktopPage.setViewport({ width: 1280, height: 900 });
  await desktopPage.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
  await desktopPage.screenshot({ path: path.join(__dirname, 'desktop_view.png') });
  console.log('Desktop screenshot saved');

  // 2. Mobile Screenshot
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mobilePage.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
  await mobilePage.screenshot({ path: path.join(__dirname, 'mobile_view.png') });
  console.log('Mobile screenshot saved');

  await browser.close();
}

run().catch(console.error);
