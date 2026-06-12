import { describe, expect, test } from "bun:test";
import { formatPredictionCapacitySuffix, formatPredictionText } from "../../packages/core/src/formatters/text.js";

describe("formatPredictionText", () => {
  test("normal prediction", () => {
    const result = formatPredictionText({
      predictedSpare: 30.1,
      confidence: "medium",
      sampleDays: 25,
      overBudget: false,
    });
    expect(result).toContain("+30%");
    expect(result).toContain("medium confidence");
    expect(result).toContain("25 days history");
  });

  test("over-budget prediction", () => {
    const result = formatPredictionText({
      predictedSpare: -12,
      confidence: "high",
      sampleDays: 30,
      overBudget: true,
    });
    expect(result).toContain("OVER BUDGET");
    expect(result).toContain("-12%");
  });

  test("zero spare", () => {
    const result = formatPredictionText({
      predictedSpare: 0,
      confidence: "low",
      sampleDays: 3,
      overBudget: false,
    });
    expect(result).toContain("0%");
    expect(result).toContain("low confidence");
  });
});

describe("formatPredictionCapacitySuffix", () => {
  test("normal prediction suffix", () => {
    const result = formatPredictionCapacitySuffix({
      predictedSpare: 30,
      overBudget: false,
    });
    expect(result).toContain("+30%");
    expect(result).toContain("spare");
  });

  test("over-budget suffix", () => {
    const result = formatPredictionCapacitySuffix({
      predictedSpare: -12,
      overBudget: true,
    });
    expect(result).toContain("OVER BUDGET");
  });
});
