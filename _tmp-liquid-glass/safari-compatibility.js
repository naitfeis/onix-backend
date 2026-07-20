// Safari Compatibility for Liquid Glass Effect
// This script fixes Safari rendering issues without altering the visual appearance
// Include this script AFTER your HTML content for Safari users

(function() {
    'use strict';
    
    // Safari compatibility - preserves visual effect while fixing rendering issues
    function initSafariCompatibility() {
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        if (isSafari) {
            // Force Safari to properly render SVG filters by triggering reflows
            const svgFilter = document.querySelector('#glass-distortion');
            if (svgFilter) {
                // Initial fix - force Safari to acknowledge the filter
                setTimeout(() => {
                    const containers = document.querySelectorAll('.glass-effect');
                    containers.forEach(container => {
                        // Temporarily force a style recalculation
                        const originalFilter = container.style.filter;
                        container.style.filter = 'none';
                        container.offsetHeight; // Force reflow
                        container.style.filter = originalFilter;
                    });
                }, 50);
                
                // Additional Safari-specific reflow trigger
                setTimeout(() => {
                    svgFilter.style.display = 'none';
                    svgFilter.offsetHeight; // Trigger reflow
                    svgFilter.style.display = '';
                }, 100);
            }
        }
    }
    
    // Helper function to force Safari filter re-rendering (preserves visual effect)
    function forceSafariFilterRefresh() {
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
            const svgFilter = document.querySelector('#glass-distortion');
            if (svgFilter) {
                // Force Safari to re-render the filter without changing appearance
                requestAnimationFrame(() => {
                    svgFilter.style.display = 'none';
                    svgFilter.offsetHeight; // Trigger reflow
                    svgFilter.style.display = '';
                });
            }
        }
    }
    
    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSafariCompatibility);
    } else {
        initSafariCompatibility();
    }
    
    // Export the refresh function for manual use if needed
    window.forceSafariGlassRefresh = forceSafariFilterRefresh;
    
})();