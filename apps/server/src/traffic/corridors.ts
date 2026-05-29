export interface CorridorDefinition {
  id: string;
  name: string;
  polyline: Array<[number, number]>; // [lng, lat]
  bufferMeters: number;
}

export const trondheimCorridors: CorridorDefinition[] = [
  {
    id: "e6-south",
    name: "E6 sør inn mot Trondheim",
    bufferMeters: 800,
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
    polyline: [
      [10.55, 63.43],
      [10.49, 63.43],
      [10.435, 63.425],
      [10.403, 63.43],
    ],
  },
];
