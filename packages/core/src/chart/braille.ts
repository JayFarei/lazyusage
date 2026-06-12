const BRAILLE_BASE_CODEPOINT = 0x2800;

const DOT_MASKS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

export const BRAILLE_EMPTY = "\u2800";

export interface BrailleCanvas {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  clear(): void;
  setPixel(x: number, y: number): void;
  toRows(): string[];
}

export function createBrailleCanvas(widthCells: number, heightCells: number): BrailleCanvas {
  const safeWidth = Math.max(1, Math.floor(widthCells));
  const safeHeight = Math.max(1, Math.floor(heightCells));
  const cells = new Uint8Array(safeWidth * safeHeight);

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < safeWidth * 2 && y < safeHeight * 4;

  return {
    widthCells: safeWidth,
    heightCells: safeHeight,
    pixelWidth: safeWidth * 2,
    pixelHeight: safeHeight * 4,
    clear() {
      cells.fill(0);
    },
    setPixel(x: number, y: number) {
      if (!inBounds(x, y)) {
        return;
      }

      const cellX = Math.floor(x / 2);
      const cellY = Math.floor(y / 4);
      const mask = DOT_MASKS[y % 4]?.[x % 2];
      if (mask == null) {
        return;
      }

      cells[cellY * safeWidth + cellX] |= mask;
    },
    toRows() {
      return Array.from({ length: safeHeight }, (_, rowIndex) => {
        const start = rowIndex * safeWidth;
        const end = start + safeWidth;
        return Array.from(cells.slice(start, end), (cell) => String.fromCodePoint(BRAILLE_BASE_CODEPOINT + cell)).join(
          "",
        );
      });
    },
  };
}
