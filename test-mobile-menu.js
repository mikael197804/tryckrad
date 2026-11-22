const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 12 Pro size
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  
  const page = await context.newPage();
  
  // Navigate to login
  await page.goto('http://127.0.0.1:3033/login');
  
  // Fill in login form
  await page.fill('input[name="name"]', 'Mikael');
  await page.fill('input[name="password"]', 'Tips172F35!');
  
  // Click login button
  await page.click('button[type="submit"]');
  
  // Wait for navigation
  await page.waitForURL('http://127.0.0.1:3033/');
  
  // Wait for page to load
  await page.waitForTimeout(2000);
  
  // Take screenshot of the menu
  await page.screenshot({ path: '/tmp/mobile-menu-after-login.png', fullPage: false });
  
  console.log('✓ Login successful');
  console.log('✓ Screenshot saved to /tmp/mobile-menu-after-login.png');
  
  // Test menu buttons
  const menuButtons = ['Topp', 'Oddset', 'PP', 'Resultat', 'Access'];
  
  for (const buttonText of menuButtons) {
    try {
      const button = await page.getByText(buttonText, { exact: true });
      const isVisible = await button.isVisible();
      console.log(`✓ ${buttonText} button is ${isVisible ? 'visible' : 'NOT visible'}`);
      
      if (isVisible) {
        await button.click();
        await page.waitForTimeout(500);
        console.log(`✓ ${buttonText} button clicked successfully`);
        
        // If it's a panel button, close it
        if (buttonText === 'Resultat' || buttonText === 'Access') {
          const closeButton = await page.locator('button').filter({ hasText: /stäng|×|close/i }).first();
          if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeButton.click();
            console.log(`✓ Closed ${buttonText} panel`);
          }
        }
      }
    } catch (error) {
      console.log(`✗ ${buttonText} button error: ${error.message}`);
    }
  }
  
  // Final screenshot
  await page.screenshot({ path: '/tmp/mobile-menu-final.png', fullPage: false });
  console.log('✓ Final screenshot saved to /tmp/mobile-menu-final.png');
  
  await browser.close();
})();
