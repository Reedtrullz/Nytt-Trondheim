export interface CorridorDefinition {
  id: string;
  name: string;
  polyline: Array<[number, number]>; // [lng, lat]
  bufferMeters: number;
  travelTimeLocationIds?: string[];
}

// Curated from production DATEX TravelTime rows inspected 2026-05-29.
const corridorTravelTimeIds = {
  // 100141/100142: E6 Okstadbakken - E6 Sluppenrampene (begge retninger)
  // 100071/100080: E6 Moholt - E6 Sluppenrampene (begge retninger)
  "e6-south": ["100141", "100142", "100071", "100080"],
  // 100137/100138: Omkjøringsveien Moholt - Tunga (begge retninger)
  // 100135/100136: E6 Moholt - E6 Sluppenrampene (begge retninger)
  omkjoringsveien: ["100137", "100138", "100135", "100136"],
  // 100135/100136: E6 Moholt - E6 Sluppenrampene (begge retninger)
  // 100322/100323: E6 Moholt - E6 Ranheim / E6 Ranheim - Fv6692 Havnegata
  "e6-east": ["100135", "100136", "100322", "100323"],
} satisfies Record<string, string[]>;

export const trondheimCorridors: CorridorDefinition[] = [
  {
    id: "e6-south",
    name: "E6 sør inn mot Trondheim",
    bufferMeters: 800,
    travelTimeLocationIds: corridorTravelTimeIds["e6-south"],
    polyline: [
      [10.379, 63.341],
      [10.378, 63.37],
      [10.392, 63.399],
      [10.403, 63.43],
    ],
  },
  {
    id: "omkjoringsveien",
    name: "Omkjøringsveien",
    bufferMeters: 800,
    travelTimeLocationIds: corridorTravelTimeIds.omkjoringsveien,
    polyline: [
      [10.33, 63.395],
      [10.375, 63.397],
      [10.435, 63.405],
    ],
  },
  {
    id: "e6-east",
    name: "E6 øst / Ranheim inn mot byen",
    bufferMeters: 800,
    travelTimeLocationIds: corridorTravelTimeIds["e6-east"],
    polyline: [
      [10.55, 63.43],
      [10.49, 63.43],
      [10.435, 63.425],
      [10.403, 63.43],
    ],
  },
];
