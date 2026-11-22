const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  
  const page = await context.newPage();
  
  await page.goto('http://127.0.0.1:3033/login');
  await page.fill('input[name="name"]', 'Mikael');
  await page.fill('input[name="password"]', 'Tips172F35!');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://127.0.0.1:3033/');
  await page.waitForTimeout(2000);
  
  console.log('\n=== MOBILE MENU DETAILED TEST REPORT ===\n');
  
  // Check viewport dimensions
  const viewport = page.viewportSize();
  console.log(`Viewport: ${viewport.width}x${viewport.height}`);
  
  // Check for horizontal scrollbar
  const hasHorizontalScroll = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log(`Horizontal scrolling required: ${hasHorizontalScroll ? 'YES ⚠️' : 'NO ✓'}`);
  
  // Get all menu buttons
  const buttons = await page.locator('nav button, header button, [role="navigation"] button').all();
  console.log(`\nTotal menu buttons found: ${buttons.length}`);
  
  // Check each button
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i];
    const text = await button.textContent();
    const box = await button.boundingBox();
    const isVisible = await button.isVisible();
    
    if (box) {
      const isInViewport = box.x >= 0 && box.x + box.width <= viewport.width;
      console.log(`\nButton ${i + 1}: "${text}"`);
      console.log(`  Position: x=${Math.round(box.x)}, y=${Math.round(box.y)}`);
      console.log(`  Size: ${Math.round(box.width)}×${Math.round(box.height)}px`);
      console.log(`  Visible: ${isVisible ? '✓' : '✗'}`);
      console.log(`  In viewport: ${isInViewport ? '✓' : '✗ CUT OFF'}`);
    }
  }
  
  // Take a full-height screenshot
  await page.screenshot({ path: '/tmp/mobile-menu-detailed.png', fullPage: true });
  console.log('\n✓ Detailed screenshot saved to /tmp/mobile-menu-detailed.png\n');
  
  await browser.close();
})();
