import { spacing, radius, fontSize, fontWeight, fontFamily, tintedGlow } from "./tokens";

// Renders ask_user_choice's options as clickable pills — the model hands
// back a question + 2-5 short labels instead of prose the user has to
// type a full reply to (2026-09-02, JuanJo: "much like you do, and make
// them choose"). Shared across every chat surface (Chat canvas, Agent
// Work chat, Dev Slate chat) rather than built three times — same
// {options, onPick} contract everywhere, styled per-canvas via `hue`.
//
// Deliberately NOT a replacement for the text input — clicking an option
// just sends its exact label as the next message, same as typing it
// would. `disabled` covers the moment right after a click, before the
// next reply has arrived, so a double-click can't fire two sends.
export function ChoiceButtons({ options, hue, onPick, disabled }: {
  options: string[]; hue: number; onPick: (text: string) => void; disabled?: boolean;
}) {
  if (options.length === 0) return null;
  const color = `oklch(65% 0.12 ${hue})`;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.xs, marginTop: 2 }}>
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => onPick(option)}
          disabled={disabled}
          style={{
            padding: `${spacing.xxs}px ${spacing.sm}px`, borderRadius: radius.md,
            border: `1px solid ${color}66`, background: tintedGlow(hue, 0.12),
            color, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
            fontSize: fontSize.xs, fontWeight: fontWeight.medium, fontFamily,
            textAlign: "left",
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
