/**
 * Owl Assist - Device Detection & Router
 * Redirects users to mobile-specific UI if viewing on a mobile device,
 * and handles real-time switching when the window is resized.
 */
(function() {
    function checkRedirect() {
        // Detect mobile based on user agent and screen width
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSmallScreen = window.innerWidth <= 768;
        const isMobile = isMobileDevice || isSmallScreen;
        
        const currentPath = window.location.pathname;
        const fileName = currentPath.split('/').pop();
        
        // Define redirection maps
        const desktopToMobile = {
            'dashboard': 'dashboard-mobile',
            'dashboard.html': 'dashboard-mobile',
            'index': 'index-mobile',
            'index.html': 'index-mobile'
        };
        
        const mobileToDesktop = {
            'dashboard-mobile': 'dashboard',
            'dashboard-mobile.html': 'dashboard',
            'index-mobile': 'index',
            'index-mobile.html': 'index'
        };

        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        // Check if we need to redirect
        if (isMobile) {
            // If on mobile and currently on a desktop page that has a mobile equivalent
            if (desktopToMobile[fileName]) {
                let target = desktopToMobile[fileName];
                if (isLocal && !target.endsWith('.html')) target += '.html';
                window.location.href = target;
            }
        } else {
            // If on desktop and currently on a mobile-specific page
            if (mobileToDesktop[fileName]) {
                let target = mobileToDesktop[fileName];
                if (isLocal && !target.endsWith('.html')) target += '.html';
                window.location.href = target;
            }
        }
    }

    // Support local live servers by appending .html to extension-less links
    document.addEventListener('DOMContentLoaded', () => {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal) {
            document.querySelectorAll('a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && !href.startsWith('http') && !href.startsWith('#') && !href.includes('.html')) {
                    if (href.includes('?')) {
                        a.setAttribute('href', href.replace('?', '.html?'));
                    } else {
                        a.setAttribute('href', href + '.html');
                    }
                }
            });
        }
    });

    // Run immediately on load
    checkRedirect();

    // Listen for resize events to handle real-time switching
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(checkRedirect, 250); // Debounce to prevent rapid multiple redirects
    });
})();
