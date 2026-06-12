/**
 * OpenTUI currently renders rounded borders via the runtime value "rounded",
 * while the published TypeScript prop type only admits "round".
 * Cast once here so components can keep the intended runtime behavior.
 */
export const ROUNDED_BORDER_STYLE = "rounded" as unknown as "round";
