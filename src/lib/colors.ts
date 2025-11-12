import type { ParticipantAvailability } from "@/types";

const palette = [
  "#0ea5e9",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#10b981",
];

const brighten = (hex: string, amount = 0.25) => {
  const parsed = hex.replace("#", "");
  const num = parseInt(parsed, 16);
  const r = Math.min(255, Math.round(((num >> 16) & 0xff) * (1 + amount)));
  const g = Math.min(255, Math.round(((num >> 8) & 0xff) * (1 + amount)));
  const b = Math.min(255, Math.round((num & 0xff) * (1 + amount)));
  return `rgb(${r}, ${g}, ${b})`;
};

export type ParticipantColor = {
  primary: string;
  highlight: string;
};

export type ParticipantColorMap = Record<string, ParticipantColor>;

export const buildParticipantColorMap = (
  participants: ParticipantAvailability[]
): ParticipantColorMap => {
  const map: ParticipantColorMap = {};

  participants.forEach((participant, index) => {
    const color = palette[index % palette.length];
    map[participant.id] = {
      primary: color,
      highlight: brighten(color, 0.35),
    };
  });

  return map;
};

export const buildColorMapFromIds = (ids: string[]): ParticipantColorMap => {
  const map: ParticipantColorMap = {};
  Array.from(new Set(ids)).forEach((id, index) => {
    const color = palette[index % palette.length];
    map[id] = {
      primary: color,
      highlight: brighten(color, 0.35),
    };
  });
  return map;
};


