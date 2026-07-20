# Liquid Glass Effect

A modern, customizable glass morphism effect for web elements.

 ## Installation
 
 1. Add the `liquid-glass-effect.css` file to your project
 2. Link it in your HTML: `<link rel="stylesheet" href="liquid-glass-effect.css">`
 3. Include the displacement map from `glass-displacement-map.html` in your page
 4. **For Safari compatibility**: Include `safari-compatibility.js` (optional, preserves visual effect)

## Basic Usage

 ### HTML Structure
 ```html
 <!DOCTYPE html>
 <html>
 <head>
     <link rel="stylesheet" href="liquid-glass-effect.css">
 </head>
 <body>
     <!-- Include the displacement map (copy from glass-displacement-map.html) -->
     <svg style="position: absolute; width: 0; height: 0;" xmlns="http://www.w3.org/2000/svg">
         <defs>
             <filter id="glass-distortion">
                 <feTurbulence baseFrequency="0.001" numOctaves="2" result="turbulence"/>
                 <feDisplacementMap in="SourceGraphic" in2="turbulence" scale="0"/>
             </filter>
         </defs>
     </svg>
 
     <!-- Your glass element -->
     <div class="glass-effect">
         <h2 class="glass-text">Your Text Here</h2>
     </div>
     
     <!-- Optional: Safari compatibility (recommended for Safari users) -->
     <script src="safari-compatibility.js"></script>
 </body>
 </html>
 ```

## Customization

### CSS Variables
You can customize the glass effect by modifying these CSS variables in your `:root` selector:

- `--shadow-blur`: Inner shadow blur radius
- `--shadow-spread`: Inner shadow spread
- `--shadow-color`: Inner shadow color
- `--tint-color`: Glass tint color (RGB values)
- `--tint-opacity`: Glass tint opacity (0-1)
- `--frost-blur`: Background blur intensity
- `--noise-frequency`: Distortion noise frequency
- `--distortion-strength`: Distortion intensity
- `--outer-shadow-blur`: Drop shadow blur radius

### Example Customization
```css
:root {
    --shadow-blur: 30px;
    --tint-color: 138, 43, 226; /* Purple tint */
    --tint-opacity: 0.3;
    --frost-blur: 4px;
}
```

## Advanced Usage

### Making it Draggable
Add the `draggable` class to enable drag functionality:
```html
<div class="glass-effect draggable">
    <h2 class="glass-text">Draggable Glass</h2>
</div>
```

Note: Dragging functionality requires additional JavaScript (not included in this package).

### Multiple Glass Elements
You can have multiple glass elements on the same page. Each will use the same displacement map:
```html
<div class="glass-effect">
    <p>First glass element</p>
</div>

<div class="glass-effect">
    <p>Second glass element</p>
</div>
```

 ## Browser Support
 
 - Modern browsers with CSS backdrop-filter support
 - Safari requires `-webkit-backdrop-filter`
 - Fallback styling provided for older browsers
 
 ### Safari Compatibility
 
 Safari can have issues rendering SVG filters properly. The included `safari-compatibility.js` fixes this by:
 
 - **Automatically detecting Safari** and applying browser-specific rendering fixes
 - **Forcing SVG filter re-rendering** to ensure distortion effects display correctly
 - **Preserving the exact visual appearance** - no changes to the beautiful glass effect
 - **Zero impact on other browsers** - only runs Safari-specific code when needed
 
 The script is completely optional but **highly recommended** for Safari users. It's a small JavaScript file that ensures the liquid glass effect renders perfectly on Safari without altering the visual appearance.

## Notes

- The displacement map SVG must be included on every page where you use the glass effect
- The SVG can be placed anywhere in your HTML (it's hidden with `width: 0; height: 0`)
- For best results, use the glass effect over background images or gradients
- The effect works best with light or semi-transparent backgrounds

Generated with current settings:
- Font Size: 28px
- Font Color: #333333
- Text Content: "Your Text Here"
- Background: data:image/jpeg;base64,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
- Noise Frequency: 0.001
- Distortion: 0
