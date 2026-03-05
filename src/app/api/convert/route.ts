import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// #region agent log - H1: Check sharp import
let sharpModule: typeof import("sharp") | null = null;
let sharpError: string | null = null;
try {
  sharpModule = require("sharp");
  console.log("[DEBUG H1] sharp loaded successfully:", typeof sharpModule);
} catch (e: unknown) {
  sharpError = e && typeof e === "object" && "message" in e ? String(e.message) : "unknown error";
  console.error("[DEBUG H1] sharp FAILED to load:", sharpError);
}
// #endregion

// #region agent log - H2: Check potrace import
let potraceModule: typeof import("potrace") | null = null;
let potraceError: string | null = null;
try {
  potraceModule = require("potrace");
  console.log("[DEBUG H2] potrace loaded successfully:", typeof potraceModule);
} catch (e: unknown) {
  potraceError = e && typeof e === "object" && "message" in e ? String(e.message) : "unknown error";
  console.error("[DEBUG H2] potrace FAILED to load:", potraceError);
}
// #endregion

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

const toleranceMap: Record<string, number> = {
  coarse: 1.0,
  medium: 0.5,
  fine: 0.2,
  superFine: 0.1,
};

export async function POST(request: NextRequest) {
  // #region agent log - H1/H2: Early exit if modules failed
  console.log("[DEBUG] POST handler started");
  if (sharpError) {
    console.error("[DEBUG] Returning early - sharp not loaded");
    return NextResponse.json({ error: `sharp module failed: ${sharpError}` }, { status: 500 });
  }
  if (potraceError) {
    console.error("[DEBUG] Returning early - potrace not loaded");
    return NextResponse.json({ error: `potrace module failed: ${potraceError}` }, { status: 500 });
  }
  if (!sharpModule || !potraceModule) {
    return NextResponse.json({ error: "Modules not loaded" }, { status: 500 });
  }
  // #endregion

  const tempDir = join(tmpdir(), "png-to-svg");
  let inputPath = "";
  let preparedPath = "";

  try {
    // #region agent log - H4: Check tmpdir
    console.log("[DEBUG H4] tempDir:", tempDir);
    await mkdir(tempDir, { recursive: true });
    console.log("[DEBUG H4] mkdir success");
    // #endregion

    // #region agent log - H3: Check formData parsing
    console.log("[DEBUG H3] Parsing formData...");
    const formData = await request.formData();
    const file = formData.get("image") as File;
    const settingsJson = formData.get("settings") as string;
    console.log("[DEBUG H3] formData parsed, file:", file ? file.name : "null", "size:", file?.size);
    // #endregion

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    const settings: ConversionSettings = settingsJson
      ? JSON.parse(settingsJson)
      : {
          threshold: 128,
          outputColor: "#FFFFFF",
          lineFitTolerance: "medium",
        };

    const fileId = randomUUID();
    inputPath = join(tempDir, `${fileId}-input.png`);
    preparedPath = join(tempDir, `${fileId}-prepared.png`);

    // #region agent log - H5: Check buffer and file write
    console.log("[DEBUG H5] Getting arrayBuffer...");
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log("[DEBUG H5] buffer length:", buffer.length);
    await writeFile(inputPath, buffer);
    console.log("[DEBUG H5] writeFile success, inputPath:", inputPath);
    // #endregion

    // #region agent log - H5: Check sharp processing
    console.log("[DEBUG H5] Calling sharp.metadata...");
    const metadata = await sharpModule(inputPath).metadata();
    console.log("[DEBUG H5] metadata:", JSON.stringify(metadata));
    const hasAlpha = metadata.channels === 4;
    // #endregion

    if (hasAlpha) {
      // #region agent log - H5: Alpha channel processing
      console.log("[DEBUG H5] Processing alpha channel...");
      await sharpModule(inputPath)
        .extractChannel("alpha")
        .negate()
        .toFile(preparedPath);
      console.log("[DEBUG H5] Alpha processing complete");
      // #endregion
    } else {
      const stats = await sharpModule(inputPath).stats();
      const avgBrightness =
        stats.channels.slice(0, 3).reduce((sum, ch) => sum + ch.mean, 0) / 3;
      const isLight = avgBrightness > 128;

      let pipeline = sharpModule(inputPath).greyscale();
      if (isLight) {
        pipeline = pipeline.negate({ alpha: false });
      }
      await pipeline.normalize().toFile(preparedPath);
      console.log("[DEBUG H5] Non-alpha processing complete");
    }

    // #region agent log - H2: Check potrace tracing
    console.log("[DEBUG H2] Starting potrace.trace...");
    const svg = await new Promise<string>((resolve, reject) => {
      const potraceOptions = {
        threshold: settings.threshold,
        turdSize: 2,
        optCurve: true,
        optTolerance: toleranceMap[settings.lineFitTolerance] || 0.5,
        color: settings.outputColor || "#FFFFFF",
        background: "transparent",
      };

      potraceModule!.trace(preparedPath, potraceOptions, (err: Error | null, svg: string) => {
        if (err) {
          console.error("[DEBUG H2] potrace.trace error:", err);
          reject(err);
        } else {
          console.log("[DEBUG H2] potrace.trace success, svg length:", svg?.length);
          resolve(svg);
        }
      });
    });
    // #endregion

    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(preparedPath).catch(() => {}),
    ]);

    console.log("[DEBUG] Returning success response");
    return NextResponse.json({
      svg,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        originalSize: buffer.length,
        svgSize: Buffer.byteLength(svg, "utf8"),
      },
    });
  } catch (error: unknown) {
    await Promise.all([
      inputPath && unlink(inputPath).catch(() => {}),
      preparedPath && unlink(preparedPath).catch(() => {}),
    ]);

    // #region agent log - Error details
    console.error("[DEBUG ERROR] Caught error:", error);
    console.error("[DEBUG ERROR] Error type:", typeof error);
    console.error("[DEBUG ERROR] Error constructor:", error?.constructor?.name);
    if (error && typeof error === "object") {
      console.error("[DEBUG ERROR] Error keys:", Object.keys(error));
      if ("message" in error) console.error("[DEBUG ERROR] message:", error.message);
      if ("stack" in error) console.error("[DEBUG ERROR] stack:", error.stack);
    }
    // #endregion

    const errorMessage = error && typeof error === "object" && "message" in error 
      ? String(error.message) 
      : "Conversion failed";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
