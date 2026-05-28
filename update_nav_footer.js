const fs = require('fs');
const index = fs.readFileSync('index.html', 'utf8');

const navMatch = index.match(/<nav class=\"fixed top-0 w-full z-50[^>]*>([\s\S]*?)<\/nav>/);
const footerMatch = index.match(/<footer class=\"w-full border-t border-\[#c7c4d7\]\/5 bg-\[#0c1324\]\">([\s\S]*?)<\/footer>/);

const twScriptMatch = index.match(/<script src=\"https:\/\/cdn\.tailwindcss\.com\?plugins=forms,container-queries\"><\/script>/);
const twConfigMatch = index.match(/<script id=\"tailwind-config\">([\s\S]*?)<\/script>/);

const mobileScript = `
    // ── Mobile menu ───────────────────────────────────────────────────────────
    const menuBtn = document.getElementById('menuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    if(menuBtn) {
        menuBtn.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    }
`;

['pricing.html', 'faq.html'].forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // replace nav
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/, navMatch[0]);
  
  // replace footer
  content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/, footerMatch[0]);
  
  // insert tailwind if missing
  if (!content.includes('cdn.tailwindcss.com') && twScriptMatch) {
    content = content.replace('</head>', `  ${twScriptMatch[0]}\n  ${twConfigMatch[0]}\n</head>`);
  }

  // add mobile script if not present
  if (!content.includes('menuBtn.addEventListener')) {
    content = content.replace('</body>', `<script>${mobileScript}</script>\n</body>`);
  }

  fs.writeFileSync(file, content);
  console.log('Updated ' + file);
});
