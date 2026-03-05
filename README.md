# PNG to SVG Converter

A free online tool to convert PNG and JPG images to SVG vectors using advanced tracing algorithms.

![Preview](preview.png)

## Features

- 🎨 **Drag & Drop** — Simply drop your image to start
- ⚡ **Fast Conversion** — Powered by Potrace algorithm
- 🎛️ **Advanced Settings** — Fine-tune your output
- 📦 **No Installation** — Works in your browser
- 🆓 **Free & Open Source**

## Tech Stack

- **Next.js 15** — React framework
- **TypeScript** — Type safety
- **Tailwind CSS** — Styling
- **Sharp** — Image processing
- **Potrace** — Vector tracing

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

Deploy to Vercel:

```bash
npx vercel
```

## Settings

| Setting | Description |
|---------|-------------|
| SVG Version | Output SVG version (1.0, 1.1, Tiny 1.2) |
| Draw Style | Fill shapes or stroke outlines |
| Curve Types | Allowed curve types in output |
| Line Fit Tolerance | Precision of curve fitting |
| Output Color | Color of the traced paths |
| Threshold | Brightness threshold for tracing |

## License

MIT © 2026 0:LimitX
