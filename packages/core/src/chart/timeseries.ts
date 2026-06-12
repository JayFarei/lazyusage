import { createBrailleCanvas } from "./braille.js";

export interface TimeSeriesPoint {
  timestampMs: number;
  value: number;
}

export interface TimeSeriesPlotRange {
  xMinMs: number;
  xMaxMs: number;
  yMin: number;
  yMax: number;
  widthCells: number;
  heightCells: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function mapTimeToCellColumn(timestampMs: number, xMinMs: number, xMaxMs: number, widthCells: number): number {
  if (widthCells <= 1 || xMaxMs <= xMinMs) {
    return 0;
  }

  const ratio = clamp((timestampMs - xMinMs) / (xMaxMs - xMinMs), 0, 1);
  return Math.round(ratio * (widthCells - 1));
}

export function mapValueToCellRow(value: number, yMin: number, yMax: number, heightCells: number): number {
  if (heightCells <= 1 || yMax <= yMin) {
    return 0;
  }

  const ratio = clamp((value - yMin) / (yMax - yMin), 0, 1);
  return Math.round((1 - ratio) * (heightCells - 1));
}

export function mapPointToBrailleCanvas(point: TimeSeriesPoint, range: TimeSeriesPlotRange): CanvasPoint {
  const pixelWidth = Math.max(1, range.widthCells * 2);
  const pixelHeight = Math.max(1, range.heightCells * 4);

  const xRatio =
    range.xMaxMs <= range.xMinMs ? 0 : clamp((point.timestampMs - range.xMinMs) / (range.xMaxMs - range.xMinMs), 0, 1);
  const yRatio = range.yMax <= range.yMin ? 0 : clamp((point.value - range.yMin) / (range.yMax - range.yMin), 0, 1);

  return {
    x: Math.round(xRatio * (pixelWidth - 1)),
    y: Math.round((1 - yRatio) * (pixelHeight - 1)),
  };
}

function drawBrailleLine(setPixel: (x: number, y: number) => void, start: CanvasPoint, end: CanvasPoint) {
  let currentX = start.x;
  let currentY = start.y;
  const deltaX = Math.abs(end.x - start.x);
  const stepX = start.x < end.x ? 1 : -1;
  const deltaY = -Math.abs(end.y - start.y);
  const stepY = start.y < end.y ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    setPixel(currentX, currentY);
    if (currentX === end.x && currentY === end.y) {
      break;
    }

    const doubleError = error * 2;
    if (doubleError >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubleError <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

export function plotTimeSeries(points: TimeSeriesPoint[], range: TimeSeriesPlotRange): string[] {
  const canvas = createBrailleCanvas(range.widthCells, range.heightCells);
  const sortedPoints = [...points]
    .filter((point) => Number.isFinite(point.timestampMs) && Number.isFinite(point.value))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (sortedPoints.length === 0) {
    return canvas.toRows();
  }

  let previousPoint: CanvasPoint | null = null;

  for (const point of sortedPoints) {
    const mappedPoint = mapPointToBrailleCanvas(point, range);

    if (previousPoint) {
      drawBrailleLine(canvas.setPixel, previousPoint, mappedPoint);
    } else {
      canvas.setPixel(mappedPoint.x, mappedPoint.y);
    }

    previousPoint = mappedPoint;
  }

  return canvas.toRows();
}
