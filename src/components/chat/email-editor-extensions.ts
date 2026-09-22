import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

/**
 * Adds an inline `font-size` style as an attribute on the TextStyle mark
 * (which must be loaded alongside this extension). Lets the toolbar set
 * arbitrary px sizes and ensures AI-emitted `<span style="font-size: 18px">`
 * round-trips through Tiptap.
 */
export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] as string[] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.fontSize?.replace(/['"]/g, "") || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const FONT_STACKS = [
  { id: "default", label: "Default", value: null as string | null },
  { id: "system", label: "System", value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: "helvetica", label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { id: "georgia", label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { id: "times", label: "Times", value: '"Times New Roman", Times, serif' },
  { id: "courier", label: "Courier", value: '"Courier New", Courier, monospace' },
  { id: "verdana", label: "Verdana", value: "Verdana, Geneva, sans-serif" },
];

export const FONT_SIZES = [
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
  { label: "32", value: "32px" },
  { label: "48", value: "48px" },
];

export const TEXT_COLORS = [
  { label: "Default", value: null as string | null },
  { label: "Black", value: "#0a0a0a" },
  { label: "Slate", value: "#475569" },
  { label: "Gray", value: "#737373" },
  { label: "Red", value: "#dc2626" },
  { label: "Amber", value: "#d97706" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#7c3aed" },
  { label: "White", value: "#ffffff" },
];
