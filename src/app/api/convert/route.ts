import { NextRequest, NextResponse } from "next/server";
import potrace from "potrace";
import sharp from "sharp";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

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

const toleranceMap = {
  coarse: 1.0,
  medium: 0.5,
  fine: 0.2,
  superFine: 0.1,
};

export async function POST(request: NextRequest) {
  const tempDir = join(tmpdir(), "png-to-svg");
  let inputPath = "";
  let preparedPath = "";

  try {
    await mkdir(tempDir, { recursive: true });

    const formData = await request.formData();
    const file = formData.get("image") as File;
    const settingsJson = formData.get("settings") as string;

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

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    const metadata = await sharp(inputPath).metadata();
    const hasAlpha = metadata.channels === 4;

    if (hasAlpha) {
      await sharp(inputPath)
        .extractChannel("alpha")
        .negate()
        .toFile(preparedPath);
    } else {
      const stats = await sharp(inputPath).stats();
      const avgBrightness =
        stats.channels.slice(0, 3).reduce((sum, ch) => sum + ch.mean, 0) / 3;
      const isLight = avgBrightness > 128;

      let pipeline = sharp(inputPath).greyscale();
      if (isLight) {
        pipeline = pipeline.negate({ alpha: false });
      }
      await pipeline.normalize().toFile(preparedPath);
    }

    const svg = await new Promise<string>((resolve, reject) => {
      const potraceOptions = {
        threshold: settings.threshold,
        turdSize: 2,
        optCurve: true,
        optTolerance: toleranceMap[settings.lineFitTolerance] || 0.5,
        color: settings.outputColor || "#FFFFFF",
        background: "transparent",
      };

      potrace.trace(preparedPath, potraceOptions, (err: Error | null, svg: string) => {
        if (err) reject(err);
        else resolve(svg);
      });
    });

    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(preparedPath).catch(() => {}),
    ]);

    return NextResponse.json({
      svg,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        originalSize: buffer.length,
        svgSize: new Blob([svg]).size,
      },
    });
  } catch (error) {
    await Promise.all([
      inputPath && unlink(inputPath).catch(() => {}),
      preparedPath && unlink(preparedPath).catch(() => {}),
    ]);

    console.error("Conversion error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Conversion failed" },
      { status: 500 }
    );
  }
}

