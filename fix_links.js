const fs = require('fs');
const files = ['dashboard.html', 'dashboard-mobile.html', 'auth/login.html', 'auth/signup.html', 'business.html', 'index.html', 'pricing.html', 'faq.html'];

files.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    content = content.replace(/href="index"/g, 'href="index.html"');
    content = content.replace(/href="pricing"/g, 'href="pricing.html"');
    content = content.replace(/href="faq"/g, 'href="faq.html"');
    content = content.replace(/href="dashboard"/g, 'href="dashboard.html"');
    content = content.replace(/href="login"/g, 'href="login.html"');
    content = content.replace(/href="signup"/g, 'href="signup.html"');
    
    // Also handle relative links for auth folder
    content = content.replace(/href="\.\.\/index"/g, 'href="../index.html"');
    content = content.replace(/href="\.\.\/pricing"/g, 'href="../pricing.html"');
    content = content.replace(/href="\.\.\/faq"/g, 'href="../faq.html"');
    content = content.replace(/href="\.\.\/dashboard"/g, 'href="../dashboard.html"');

    fs.writeFileSync(file, content);
    console.log('Fixed links in ' + file);
  }
});
