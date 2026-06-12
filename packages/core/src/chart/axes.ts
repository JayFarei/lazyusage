import { BRAILLE_EMPTY } from "./braille.js";
import { mapTimeToCellColumn, mapValueToCellRow, plotTimeSeries, type TimeSeriesPoint } from "./timeseries.js";

export interface TimeAxisTick {
  timestampMs: number;
  label: string;
}

export interface UsageChartOptions {
  points: TimeSeriesPoint[];
  widthCells: number;
  heightCells: number;
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  yMaxPct: number;
  projectedTotalPct?: number | null;
  thresholdPct?: number;
  xTicks: TimeAxisTick[];
}

export interface UsageChartRender {
  lines: string[];
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function isBlankCell(value: string): boolean {
  return value === " " || value === BRAILLE_EMPTY;
}

function setOverlayCell(grid: string[][], x: number, y: number, value: string) {
  if (!grid[y] || !grid[y][x] || !isBlankCell(grid[y][x])) {
    return;
  }

  grid[y][x] = value;
}

function setCell(grid: string[][], x: number, y: number, value: string) {
  if (!grid[y] || !grid[y][x]) {
    return;
  }

  grid[y][x] = value;
}

function drawOverlayLine(grid: string[][], startX: number, startY: number, endX: number, endY: number, value: string) {
  let currentX = startX;
  let currentY = startY;
  const deltaX = Math.abs(endX - startX);
  const stepX = startX < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - startY);
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    setOverlayCell(grid, currentX, currentY, value);
    if (currentX === endX && currentY === endY) {
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

function renderAxisLabels(
  widthCells: number,
  windowStartMs: number,
  windowEndMs: number,
  ticks: TimeAxisTick[],
): string {
  const chars = Array.from({ length: widthCells }, () => " ");
  let nextWritableColumn = 0;

  for (const tick of ticks) {
    const label = tick.label;
    if (!label) {
      continue;
    }

    const column = mapTimeToCellColumn(tick.timestampMs, windowStartMs, windowEndMs, widthCells);
    const start = Math.max(
      nextWritableColumn,
      Math.min(widthCells - label.length, column - Math.floor(label.length / 2)),
    );

    if (start + label.length > widthCells) {
      continue;
    }

    for (let index = 0; index < label.length; index += 1) {
      const character = label[index];
      if (character === undefined) {
        continue;
      }

      chars[start + index] = character;
    }

    nextWritableColumn = start + label.length + 1;
  }

  return chars.join("").trimEnd();
}

export function createTimeAxisTicks(mode: "weekly" | "session", windowStartMs: number): TimeAxisTick[] {
  if (mode === "weekly") {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const timestampMs = windowStartMs + dayIndex * 24 * 3600_000;
      return {
        timestampMs,
        label: WEEKDAY_LABELS[new Date(timestampMs).getDay()] ?? "",
      };
    });
  }

  return Array.from({ length: 6 }, (_, hourIndex) => ({
    timestampMs: windowStartMs + hourIndex * 3600_000,
    label: `${hourIndex}h`,
  }));
}

export function renderUsageChart(options: UsageChartOptions): UsageChartRender {
  const widthCells = Math.max(12, Math.floor(options.widthCells));
  const heightCells = Math.max(6, Math.floor(options.heightCells));
  const yMaxPct = Math.max(100, options.yMaxPct);
  const thresholdPct = options.thresholdPct ?? 100;
  const plotRows = plotTimeSeries(options.points, {
    xMinMs: options.windowStartMs,
    xMaxMs: options.windowEndMs,
    yMin: 0,
    yMax: yMaxPct,
    widthCells,
    heightCells,
  });
  const grid = plotRows.map((row) => Array.from(row, (cell) => (cell === BRAILLE_EMPTY ? " " : cell)));

  const thresholdRow = mapValueToCellRow(thresholdPct, 0, yMaxPct, heightCells);
  for (let x = 0; x < widthCells; x += 1) {
    setOverlayCell(grid, x, thresholdRow, "─");
  }

  for (const tick of options.xTicks) {
    const column = mapTimeToCellColumn(tick.timestampMs, options.windowStartMs, options.windowEndMs, widthCells);
    for (let y = 0; y < heightCells; y += 1) {
      setOverlayCell(grid, column, y, "┆");
    }
  }

  const nowColumn = mapTimeToCellColumn(options.nowMs, options.windowStartMs, options.windowEndMs, widthCells);
  for (let y = 0; y < heightCells; y += 1) {
    setOverlayCell(grid, nowColumn, y, "│");
  }

  drawOverlayLine(
    grid,
    0,
    mapValueToCellRow(0, 0, yMaxPct, heightCells),
    widthCells - 1,
    mapValueToCellRow(thresholdPct, 0, yMaxPct, heightCells),
    "·",
  );

  const latestPoint = options.points.at(-1);
  if (latestPoint && options.projectedTotalPct != null) {
    drawOverlayLine(
      grid,
      mapTimeToCellColumn(latestPoint.timestampMs, options.windowStartMs, options.windowEndMs, widthCells),
      mapValueToCellRow(latestPoint.value, 0, yMaxPct, heightCells),
      widthCells - 1,
      mapValueToCellRow(options.projectedTotalPct, 0, yMaxPct, heightCells),
      "┈",
    );
  }

  if (latestPoint) {
    setCell(
      grid,
      mapTimeToCellColumn(latestPoint.timestampMs, options.windowStartMs, options.windowEndMs, widthCells),
      mapValueToCellRow(latestPoint.value, 0, yMaxPct, heightCells),
      "◆",
    );
  }

  const labelWidth = String(Math.round(yMaxPct)).length + 1;
  const lines = grid.map((row, rowIndex) => {
    let label = "";
    if (rowIndex === 0) {
      label = `${Math.round(yMaxPct)}%`;
    } else if (rowIndex === thresholdRow && thresholdRow !== 0 && thresholdRow !== heightCells - 1) {
      label = `${Math.round(thresholdPct)}%`;
    } else if (rowIndex === heightCells - 1) {
      label = "0%";
    }

    return `${label.padStart(labelWidth)} ${row.join("")}`;
  });

  lines.push(
    `${" ".repeat(labelWidth + 1)} ${renderAxisLabels(
      widthCells,
      options.windowStartMs,
      options.windowEndMs,
      options.xTicks,
    )}`,
  );

  return { lines };
}
