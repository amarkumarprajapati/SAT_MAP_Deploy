export type VesselSizeClass = "small" | "medium" | "large" | "very_large" | "unknown";

export function vesselSizeClass(ship: Record<string, unknown>): VesselSizeClass {
  const reportedClass = String(ship.sizeClass ?? "").toLowerCase();
  if (["small", "medium", "large", "very_large", "unknown"].includes(reportedClass)) {
    return reportedClass as VesselSizeClass;
  }
  const length = Number(ship.length ?? ship.length_m);
  if (Number.isFinite(length) && length > 0) {
    if (length < 50) return "small";
    if (length < 120) return "medium";
    if (length < 250) return "large";
    return "very_large";
  }
  const typeCode = Number(ship.aisTypeCode);
  if ((typeCode >= 30 && typeCode <= 39) || (typeCode >= 50 && typeCode <= 59)) return "small";
  if (typeCode >= 60 && typeCode <= 69) return "medium";
  if (typeCode >= 70 && typeCode <= 89) return "large";
  return "unknown";
}

export function vesselIconKey(ship: Record<string, unknown>, selected = false): string {
  const sizeClass = vesselSizeClass(ship);
  const rawType = String(ship.type ?? "cargo").toLowerCase();
  const type = rawType === "tanker" || rawType === "military" ? rawType : "cargo";
  return `ship-${selected ? "selected-" : ""}${sizeClass}-${type}`;
}

export function vesselIconScale(ship: Record<string, unknown>): number {
  const length = Number(ship.length ?? ship.length_m);
  if (!Number.isFinite(length) || length <= 0) {
    return { small: 0.68, medium: 0.9, large: 1.18, very_large: 1.48, unknown: 0.9 }[vesselSizeClass(ship)];
  }
  if (length < 50) return 0.58 + (length / 50) * 0.18;
  if (length < 120) return 0.76 + ((length - 50) / 70) * 0.24;
  if (length < 250) return 1 + ((length - 120) / 130) * 0.28;
  return Math.min(1.55, 1.28 + ((length - 250) / 250) * 0.27);
}
