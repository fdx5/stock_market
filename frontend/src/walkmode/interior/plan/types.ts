/* The normalised floor plan every interior is built from (the walk-mode spec §10.2). Metres, in the
 * interior's own frame: x to the right looking at the plan with the front (the balcony side, usually
 * south) at the bottom, z toward the front — the same axes the scene uses (y up). */

export type RoomType = "living" | "kitchen" | "bedroom" | "master" | "bathroom" | "ensuite" | "dressroom" | "entrance" | "utility" | "balcony" | "hall" | "alpha";
export type Side = "n" | "s" | "e" | "w";

export interface Room {
  id: string;
  type: RoomType;
  label: string;
  /** an axis-aligned rectangle: [x0, z0, x1, z1] */
  rect: [number, number, number, number];
  /** rooms sharing one light zone (no wall between them: the living room, dining and kitchen) */
  zone: string;
  /** a floor a little lower (the entrance, bathrooms, the balcony) */
  floorDrop?: number;
}

export interface Opening {
  type: "door" | "sliding_door" | "front_door" | "glass_door" | "window" | "balcony_window" | "open";
  /** the two rooms it joins ("out" for the outside) */
  a: string; b: string;
  /** the wall it is in: the shared edge's axis and position */
  axis: "x" | "z"; at: number;
  /** its centre along the wall, and its size */
  center: number; width: number; height: number; sill: number;
  /** which side the leaf hinges on and which room it swings into (doors) */
  hinge?: "start" | "end"; swingInto?: string;
}

export interface Fixture {
  type: "toilet" | "bathtub" | "shower" | "washbasin" | "sink" | "cooktop" | "boiler" | "washer" | "switch";
  pos: [number, number]; rot: number; room: string;
}

export interface FloorPlan {
  complexId: string; complexName: string; dong: string; unitType: string;
  areaExclusiveM2: number; ceilingHeightM: number;
  source: "estimated_template" | "licensed_plan";
  template: string;
  basis: { area: string; rooms: string; households?: number | null; built?: number | null };
  bounds: [number, number, number, number];
  rooms: Room[];
  openings: Opening[];
  fixtures: Fixture[];
  /** the sum of the rooms' floor areas (excluding the balcony) and how far it is from the target */
  check: { areaM2: number; error: number };
  style: StyleName;
  floor: number;
}

export type StyleName = "modern_white" | "wood_natural" | "gray_minimal" | "classic_walnut" | "nordic_bright" | "hotel_dark" | "vintage_warm";

/** Unit types as the server sends them (the trade records' 전용면적, the register's own rows). */
export interface UnitType { key: string; areaM2: number; trades: number; label: string; rooms?: number; baths?: number; source: string; households?: number; floors?: [number | null, number | null] }
export interface UnitsResponse {
  complexId: string; name: string; built: number | null; households: number | null;
  types: UnitType[];
  dong?: { name: string; floors: number | null; areaRows: number } | null;
  sources: string[];
}
