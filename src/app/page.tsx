"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface ConversionSettings {
  svgVersion: "1.0" | "1.1" | "tiny1.2";
  drawStyle: "fill" | "stroke" | "strokeEdges";
  shapeStacking: "cutouts" | "stack";
  groupBy: "none" | "color" | "parent" | "layer";
  curveTypes: {
    lines: boolean;
    quadratic: boolean;
    cubic: boolean;
    circular: boolean;
    elliptical: boolean;
  };
  lineFitTolerance: "coarse" | "medium" | "fine" | "superFine";
  fillGaps: boolean;
  clipOverflow: boolean;
  strokeWidth: number;
  outputColor: string;
  threshold: number;
}

const defaultSettings: ConversionSettings = {
  svgVersion: "1.1",
  drawStyle: "fill",
  shapeStacking: "cutouts",
  groupBy: "none",
  curveTypes: {
    lines: true,
    quadratic: true,
    cubic: true,
    circular: true,
    elliptical: true,
  },
  lineFitTolerance: "medium",
  fillGaps: true,
  clipOverflow: false,
  strokeWidth: 2,
  outputColor: "#FFFFFF",
  threshold: 128,
};

// #region agent log - Client-side tracing
declare global {
  interface Window {
    ImageTracer: {
      imageToSVG: (
        url: string,
        callback: (svgString: string) => void,
        options?: Record<string, unknown>
      ) => void;
    };
  }
}
// #endregion

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [svgResult, setSvgResult] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [settings, setSettings] = useState<ConversionSettings>(defaultSettings);
  const [error, setError] = useState<string | null>(null);
  const [tracerLoaded, setTracerLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load ImageTracer library
  useEffect(() => {
    // #region agent log - Load ImageTracer script
    console.log("[DEBUG] Loading ImageTracer script...");
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js";
    script.async = true;
    script.onload = () => {
      console.log("[DEBUG] ImageTracer loaded successfully");
      setTracerLoaded(true);
    };
    script.onerror = (e) => {
      console.error("[DEBUG] ImageTracer failed to load:", e);
      setError("Failed to load image tracer library");
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
    // #endregion
  }, []);

  const handleFile = useCallback((selectedFile: File) => {
    if (!selectedFile.type.startsWith("image/")) {
      setError("Please select an image file (PNG, JPG, etc.)");
      return;
    }
    setFile(selectedFile);
    setError(null);
    setSvgResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(selectedFile);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // Preprocess image - extract alpha channel for transparent images
  const preprocessImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        
        // Draw image to get pixel data
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Check if image has transparency and is mostly light
        let hasAlpha = false;
        let totalBrightness = 0;
        let opaquePixels = 0;
        
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 255 && alpha > 0) hasAlpha = true;
          if (alpha > 128) {
            const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            totalBrightness += brightness;
            opaquePixels++;
          }
        }
        
        const avgBrightness = opaquePixels > 0 ? totalBrightness / opaquePixels : 0;
        const isLightOnTransparent = hasAlpha && avgBrightness > 200;
        
        console.log("[DEBUG] Image analysis:", { hasAlpha, avgBrightness: avgBrightness.toFixed(0), isLightOnTransparent });
        
        if (isLightOnTransparent) {
          // Extract alpha channel as grayscale (inverted for tracing)
          console.log("[DEBUG] Extracting alpha channel as mask...");
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            // Invert: opaque becomes black (for tracing), transparent becomes white
            const value = 255 - alpha;
            data[i] = value;     // R
            data[i + 1] = value; // G
            data[i + 2] = value; // B
            data[i + 3] = 255;   // Full opacity
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } else {
          // Use original image
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });
  };

  const handleConvert = async () => {
    if (!preview || !tracerLoaded) {
      setError("Image tracer not ready");
      return;
    }

    setIsConverting(true);
    setError(null);

    try {
      console.log("[DEBUG] Starting client-side conversion...");
      
      // Preprocess image (handle white-on-transparent)
      const processedImage = await preprocessImage(preview);
      console.log("[DEBUG] Image preprocessed, starting trace...");

      // Map tolerance to ltres (line threshold)
      const toleranceMap: Record<string, number> = {
        coarse: 10,
        medium: 5,
        fine: 2,
        superFine: 1,
      };

      const options = {
        ltres: toleranceMap[settings.lineFitTolerance] || 5,
        qtres: toleranceMap[settings.lineFitTolerance] || 5,
        pathomit: 4,
        colorsampling: 0, // Disable color sampling for B&W
        numberofcolors: 2,
        mincolorratio: 0,
        colorquantcycles: 1,
        scale: 1,
        roundcoords: 1,
        lcpr: 0,
        qcpr: 0,
        desc: false,
        viewbox: true,
        blurradius: 0,
        blurdelta: 20,
      };

      console.log("[DEBUG] Calling ImageTracer with options:", options);

      await new Promise<void>((resolve, reject) => {
        try {
          window.ImageTracer.imageToSVG(
            processedImage,
            (svgString: string) => {
              console.log("[DEBUG] Conversion complete, SVG length:", svgString?.length);
              
              // Replace black with user's output color
              svgString = svgString.replace(/fill="rgb\(0,0,0\)"/g, `fill="${settings.outputColor}"`);
              svgString = svgString.replace(/stroke="rgb\(0,0,0\)"/g, `stroke="${settings.outputColor}"`);
              svgString = svgString.replace(/fill="#000000"/g, `fill="${settings.outputColor}"`);
              svgString = svgString.replace(/stroke="#000000"/g, `stroke="${settings.outputColor}"`);
              
              // Remove white background paths
              svgString = svgString.replace(/<path[^>]*fill="rgb\(255,255,255\)"[^>]*\/>/g, "");
              svgString = svgString.replace(/<path[^>]*fill="#ffffff"[^>]*\/>/gi, "");
              svgString = svgString.replace(/<path[^>]*fill="#FFFFFF"[^>]*\/>/g, "");
              
              setSvgResult(svgString);
              resolve();
            },
            options
          );
        } catch (e) {
          console.error("[DEBUG] ImageTracer error:", e);
          reject(e);
        }
      });
    } catch (err: unknown) {
      console.error("[DEBUG] Conversion error:", err);
      const errorMessage = err && typeof err === "object" && "message" in err 
        ? String(err.message) 
        : "Conversion failed";
      setError(errorMessage);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (!svgResult) return;

    const blob = new Blob([svgResult], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name.replace(/\.[^/.]+$/, ".svg") || "converted.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setSvgResult(null);
    setError(null);
    setSettings(defaultSettings);
  };

  const updateCurveType = (key: keyof typeof settings.curveTypes) => {
    setSettings((prev) => ({
      ...prev,
      curveTypes: {
        ...prev.curveTypes,
        [key]: !prev.curveTypes[key],
      },
    }));
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      {/* Header */}
      <header className="text-center mb-8 md:mb-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
          PNG to SVG Converter
        </h1>
        <p className="text-[var(--muted)] text-lg">
          Trace Pixels To Vectors — Fast & Free
        </p>
        {!tracerLoaded && (
          <p className="text-yellow-500 text-sm mt-2">Loading image tracer...</p>
        )}
      </header>

      <div className="max-w-6xl mx-auto">
        {/* Upload Zone */}
        {!preview ? (
          <div
            className={`dropzone p-12 md:p-16 text-center cursor-pointer ${
              isDragOver ? "drag-over" : ""
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <div className="flex justify-center mb-6">
              <svg
                className="w-20 h-20 text-[var(--primary)] opacity-60"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <p className="text-xl font-medium text-[var(--primary)] mb-2">
              DRAG IMAGE HERE TO BEGIN
            </p>
            <p className="text-[var(--muted)]">
              or{" "}
              <button className="btn-primary text-sm py-2 px-4">
                PICK IMAGE TO VECTORIZE
              </button>{" "}
              or press <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-sm">CMD</kbd>{" "}
              + <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-sm">V</kbd>
            </p>
          </div>
        ) : (
          <div className="fade-in">
            {/* Preview Section */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div>
                <h3 className="font-semibold mb-3">Original (PNG)</h3>
                <div className="preview-container p-4">
                  <img src={preview} alt="Original" />
                </div>
                <p className="text-sm text-[var(--muted)] mt-2">
                  {file?.name} — {((file?.size || 0) / 1024).toFixed(1)} KB
                </p>
              </div>
              <div>
                <h3 className="font-semibold mb-3">Result (SVG)</h3>
                <div className="preview-container p-4">
                  {isConverting ? (
                    <div className="loading-spinner" />
                  ) : svgResult ? (
                    <div dangerouslySetInnerHTML={{ __html: svgResult }} />
                  ) : (
                    <p className="text-[var(--muted)]">Click Convert to generate SVG</p>
                  )}
                </div>
                {svgResult && (
                  <p className="text-sm text-[var(--muted)] mt-2">
                    SVG — {(new Blob([svgResult]).size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg mb-6">
                {error}
              </div>
            )}

            {/* Settings */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
              {/* SVG Version */}
              <div className="settings-card">
                <div className="settings-title">
                  SVG Version
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="radio-group">
                  {(["1.0", "1.1", "tiny1.2"] as const).map((v) => (
                    <label key={v}>
                      <input
                        type="radio"
                        name="svgVersion"
                        checked={settings.svgVersion === v}
                        onChange={() => setSettings({ ...settings, svgVersion: v })}
                      />
                      SVG {v === "tiny1.2" ? "Tiny 1.2" : v}
                    </label>
                  ))}
                </div>
              </div>

              {/* Draw Style */}
              <div className="settings-card">
                <div className="settings-title">
                  Draw Style
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="drawStyle"
                      checked={settings.drawStyle === "fill"}
                      onChange={() => setSettings({ ...settings, drawStyle: "fill" })}
                    />
                    Fill shapes
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="drawStyle"
                      checked={settings.drawStyle === "stroke"}
                      onChange={() => setSettings({ ...settings, drawStyle: "stroke" })}
                    />
                    Stroke shape outlines
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="drawStyle"
                      checked={settings.drawStyle === "strokeEdges"}
                      onChange={() => setSettings({ ...settings, drawStyle: "strokeEdges" })}
                    />
                    Stroke edges
                  </label>
                </div>
              </div>

              {/* Shape Stacking */}
              <div className="settings-card">
                <div className="settings-title">
                  Shape Stacking
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="shapeStacking"
                      checked={settings.shapeStacking === "cutouts"}
                      onChange={() => setSettings({ ...settings, shapeStacking: "cutouts" })}
                    />
                    Place shapes in cut-outs
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="shapeStacking"
                      checked={settings.shapeStacking === "stack"}
                      onChange={() => setSettings({ ...settings, shapeStacking: "stack" })}
                    />
                    Stack shapes on top
                  </label>
                </div>
              </div>

              {/* Allowed Curve Types */}
              <div className="settings-card">
                <div className="settings-title">
                  Allowed Curve Types
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="checkbox-group">
                  {[
                    { key: "lines", label: "Lines" },
                    { key: "quadratic", label: "Quadratic Bézier" },
                    { key: "cubic", label: "Cubic Bézier" },
                    { key: "circular", label: "Circular Arcs" },
                    { key: "elliptical", label: "Elliptical Arcs" },
                  ].map(({ key, label }) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={settings.curveTypes[key as keyof typeof settings.curveTypes]}
                        onChange={() => updateCurveType(key as keyof typeof settings.curveTypes)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Gap Filler */}
              <div className="settings-card">
                <div className="settings-title">
                  Gap Filler
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="checkbox-group mb-4">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.fillGaps}
                      onChange={() => setSettings({ ...settings, fillGaps: !settings.fillGaps })}
                    />
                    Fill Gaps
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.clipOverflow}
                      onChange={() => setSettings({ ...settings, clipOverflow: !settings.clipOverflow })}
                    />
                    Clip Overflow
                  </label>
                </div>
                <div className="slider-container">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.5"
                    value={settings.strokeWidth}
                    onChange={(e) => setSettings({ ...settings, strokeWidth: parseFloat(e.target.value) })}
                  />
                  <span className="slider-value">{settings.strokeWidth}px</span>
                </div>
              </div>

              {/* Line Fit Tolerance */}
              <div className="settings-card">
                <div className="settings-title">
                  Line Fit Tolerance
                  <span className="text-[var(--muted)] text-xs">ⓘ</span>
                </div>
                <div className="radio-group">
                  {(["coarse", "medium", "fine", "superFine"] as const).map((v) => (
                    <label key={v}>
                      <input
                        type="radio"
                        name="lineFitTolerance"
                        checked={settings.lineFitTolerance === v}
                        onChange={() => setSettings({ ...settings, lineFitTolerance: v })}
                      />
                      {v === "superFine" ? "Super Fine" : v.charAt(0).toUpperCase() + v.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              <div className="settings-card">
                <div className="settings-title">Output Color</div>
                <div className="flex items-center gap-4">
                  <input
                    type="color"
                    value={settings.outputColor}
                    onChange={(e) => setSettings({ ...settings, outputColor: e.target.value })}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={settings.outputColor}
                    onChange={(e) => setSettings({ ...settings, outputColor: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-transparent"
                  />
                </div>
              </div>
              <div className="settings-card">
                <div className="settings-title">Threshold ({settings.threshold})</div>
                <div className="slider-container">
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={settings.threshold}
                    onChange={(e) => setSettings({ ...settings, threshold: parseInt(e.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap justify-center gap-4">
              <button onClick={handleReset} className="px-6 py-3 rounded-full border border-[var(--border)] hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                ← Upload New Image
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting || !tracerLoaded}
                className="btn-primary"
              >
                {isConverting ? (
                  <>
                    <span className="loading-spinner w-5 h-5 border-2" />
                    Converting...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Convert to SVG
                  </>
                )}
              </button>
              {svgResult && (
                <button onClick={handleDownload} className="btn-primary bg-green-500 hover:bg-green-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  DOWNLOAD
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="text-center mt-16 text-sm text-[var(--muted)]">
        <p>Built with Next.js + ImageTracerJS • 100% Client-Side • Open Source on GitHub</p>
        <p className="mt-1">© 2026 0:LimitX</p>
      </footer>
    </main>
  );
}
