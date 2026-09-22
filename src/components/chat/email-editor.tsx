"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import { TextStyle } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import { FontSize, FONT_STACKS, FONT_SIZES, TEXT_COLORS } from "./email-editor-extensions";
import { apiFetch } from "@/lib/api-client";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Code,
  ImagePlus,
  Loader2,
  Sparkles,
  Type,
  Eye,
  Pencil,
  Smartphone,
  Monitor,
  Palette,
} from "lucide-react";

type ViewMode = "edit" | "preview" | "html";
type PreviewWidth = "desktop" | "mobile";

const ASPECT_RATIOS = ["16:9", "1:1", "4:3", "3:2", "9:16", "21:9"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

const ASSETS_KEY = "bs:email-assets";
const MAX_LOCAL_ASSETS = 20;

interface LocalAsset {
  id: string;
  src: string;            // data URL or hosted URL
  prompt?: string;
  alt?: string;
  source: "upload" | "generate";
  aspectRatio?: string;
  createdAt: number;
}

function saveLocalAsset(asset: LocalAsset): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    const list: LocalAsset[] = raw ? (JSON.parse(raw) as LocalAsset[]) : [];
    list.unshift(asset);
    localStorage.setItem(ASSETS_KEY, JSON.stringify(list.slice(0, MAX_LOCAL_ASSETS)));
  } catch {
    // Quota exceeded or storage disabled — silently drop. The image is already
    // embedded in the editor body so the user doesn't lose it.
  }
}

interface Props {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  /** Live email + segment context — used to ground AI image generation in the brand and the campaign content. */
  imageContext?: {
    subject?: string;
    body?: string;
    segmentName?: string;
  };
  /** Fires whenever the "what would be sent" HTML changes — template-rendered HTML
   *  in Template mode, plain Tiptap HTML otherwise. Parent uses this to decide what
   *  to forward to CleverTap on Send. */
  onSendableChange?: (sendable: { html: string; templateId: string | null }) => void;
}

export function EmailEditor({ value, onChange, disabled, placeholder, compact, imageContext, onSendableChange }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>("desktop");
  const [htmlDraft, setHtmlDraft] = useState(value);
  const showHtml = viewMode === "html";
  const showPreview = viewMode === "preview";
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [genPanelOpen, setGenPanelOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [genRatio, setGenRatio] = useState<AspectRatio>("16:9");
  const [generating, setGenerating] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        horizontalRule: { HTMLAttributes: { class: "border-border my-3" } },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "underline underline-offset-2 text-foreground",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "rounded max-w-full h-auto my-3 border border-border",
        },
      }),
      TextStyle,
      FontFamily.configure({ types: ["textStyle"] }),
      Color.configure({ types: ["textStyle"] }),
      FontSize,
    ],
    content: value || "",
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[140px] px-3 py-2 text-foreground [&_p]:my-2 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:mt-3 [&_h3]:mb-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_a]:text-foreground",
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Keep editor in sync if value changes externally (e.g. AI redraft)
  useEffect(() => {
    if (!editor) return;
    if (showHtml) return; // user is editing raw HTML — don't clobber
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor, showHtml]);

  // Sync html-mode draft with the value when toggling
  useEffect(() => {
    if (showHtml) setHtmlDraft(value);
  }, [showHtml, value]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable === !disabled) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  // Inform the parent what HTML to actually send, depending on the active view.
  // The "what would be sent" HTML is always the plain Tiptap body.
  useEffect(() => {
    if (!onSendableChange) return;
    onSendableChange({ html: value, templateId: null });
  }, [value, onSendableChange]);

  const promptForLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const uploadAndInsertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      setUploading(true);
      setUploadError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/assets/upload", {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as {
          url?: string;
          dataUrl?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
        const src = json.url ?? json.dataUrl;
        if (!src) throw new Error("No image returned");
        const alt = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
        editor.chain().focus().setImage({ src, alt }).run();
        saveLocalAsset({
          id: crypto.randomUUID(),
          src,
          alt,
          source: "upload",
          createdAt: Date.now(),
        });
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [editor],
  );

  const onPickImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      void uploadAndInsertImage(file);
    },
    [uploadAndInsertImage],
  );

  const generateAndInsertImage = useCallback(
    async (overridePrompt?: string, overrideRatio?: AspectRatio) => {
      if (!editor) return;
      const prompt = (overridePrompt ?? genPrompt).trim();
      const ratio = overrideRatio ?? genRatio;
      setGenerating(true);
      setUploadError(null);
      try {
        const json = await apiFetch<{ url?: string; dataUrl?: string }>("/api/assets/generate", {
          method: "POST",
          body: {
            prompt: prompt || undefined,
            aspectRatio: ratio,
            subject: imageContext?.subject,
            body: imageContext?.body,
            segmentName: imageContext?.segmentName,
          },
          skipModel: true,
        });
        const src = json.url ?? json.dataUrl;
        if (!src) throw new Error("No image returned");
        const alt = prompt
          ? prompt.slice(0, 80)
          : imageContext?.subject?.slice(0, 80) ?? "Email illustration";
        editor.chain().focus().setImage({ src, alt }).run();
        saveLocalAsset({
          id: crypto.randomUUID(),
          src,
          alt,
          prompt,
          source: "generate",
          aspectRatio: ratio,
          createdAt: Date.now(),
        });
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setGenerating(false);
      }
    },
    [editor, genPrompt, genRatio, imageContext],
  );

  const onSparklesClick = useCallback(() => {
    // First click on a closed panel: pre-fill the prompt from the email subject
    // (so the user sees the brief that will be used) AND fire generation immediately.
    if (!genPanelOpen) {
      const seed = (imageContext?.subject ?? "").trim();
      if (seed && !genPrompt.trim()) {
        setGenPrompt(seed);
      }
      setGenPanelOpen(true);
      void generateAndInsertImage(seed || undefined);
      return;
    }
    setGenPanelOpen(false);
  }, [genPanelOpen, generateAndInsertImage, imageContext, genPrompt]);

  if (!editor) {
    return (
      <div className="border border-border rounded bg-muted/30 min-h-[180px] animate-pulse" />
    );
  }

  const textSize = compact ? "text-xs" : "text-sm";
  const smallText = compact ? "text-[9px]" : "text-xs";

  return (
    <div className="border border-border rounded bg-background overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border bg-muted/30 flex-wrap">
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          icon={Bold}
          label="Bold"
          disabled={disabled || showHtml}
        />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          icon={Italic}
          label="Italic"
          disabled={disabled || showHtml}
        />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive("underline")}
          icon={UnderlineIcon}
          label="Underline"
          disabled={disabled || showHtml}
        />
        <Divider />
        <ToolbarSelect
          icon={Type}
          ariaLabel="Font family"
          disabled={disabled || showHtml || showPreview}
          value={(editor.getAttributes("textStyle").fontFamily as string | undefined) ?? ""}
          onChange={(v) => {
            const stack = FONT_STACKS.find((f) => (f.value ?? "") === v);
            if (!stack || stack.value === null) {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(stack.value).run();
            }
          }}
          options={FONT_STACKS.map((f) => ({ label: f.label, value: f.value ?? "" }))}
          width="w-[100px]"
          smallText={smallText}
        />
        <ToolbarSelect
          ariaLabel="Font size"
          disabled={disabled || showHtml || showPreview}
          value={(editor.getAttributes("textStyle").fontSize as string | undefined) ?? ""}
          onChange={(v) => {
            if (!v) editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(v).run();
          }}
          options={[{ label: "—", value: "" }, ...FONT_SIZES]}
          width="w-[58px]"
          smallText={smallText}
        />
        <ColorButton
          editor={editor}
          disabled={disabled || showHtml || showPreview}
          smallText={smallText}
        />
        <Divider />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          icon={Heading2}
          label="Heading 2"
          disabled={disabled || showHtml}
        />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive("heading", { level: 3 })}
          icon={Heading3}
          label="Heading 3"
          disabled={disabled || showHtml}
        />
        <Divider />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          icon={List}
          label="Bulleted list"
          disabled={disabled || showHtml}
        />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          icon={ListOrdered}
          label="Numbered list"
          disabled={disabled || showHtml}
        />
        <Divider />
        <ToolbarButton
          editor={editor}
          onClick={promptForLink}
          isActive={editor.isActive("link")}
          icon={LinkIcon}
          label="Link"
          disabled={disabled || showHtml}
        />
        <ToolbarButton
          editor={editor}
          onClick={onPickImage}
          isActive={false}
          icon={uploading ? Loader2 : ImagePlus}
          label="Insert image"
          disabled={disabled || showHtml || uploading}
          spinning={uploading}
        />
        <ToolbarButton
          editor={editor}
          onClick={onSparklesClick}
          isActive={genPanelOpen}
          icon={generating ? Loader2 : Sparkles}
          label={generating ? "Generating image…" : "Auto-generate image from email context"}
          disabled={disabled || showHtml || generating}
          spinning={generating}
        />
        <ToolbarButton
          editor={editor}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          isActive={false}
          icon={Minus}
          label="Divider"
          disabled={disabled || showHtml}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <SegmentButton
            icon={Pencil}
            label="Edit"
            active={viewMode === "edit"}
            onClick={() => {
              if (viewMode === "html") onChange(htmlDraft);
              setViewMode("edit");
            }}
            smallText={smallText}
            disabled={disabled}
          />
          <SegmentButton
            icon={Eye}
            label="Preview"
            active={viewMode === "preview"}
            onClick={() => {
              if (viewMode === "html") onChange(htmlDraft);
              setViewMode("preview");
            }}
            smallText={smallText}
            disabled={disabled}
          />
          <SegmentButton
            icon={Code}
            label="HTML"
            active={viewMode === "html"}
            onClick={() => {
              if (viewMode !== "html") {
                setHtmlDraft(value);
                setViewMode("html");
              } else {
                onChange(htmlDraft);
                setViewMode("edit");
              }
            }}
            smallText={smallText}
            disabled={disabled}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={onFileSelected}
      />

      {genPanelOpen && (
        <div className="border-b border-border bg-muted/30 px-2 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="Optional: nudge the image (leave blank to auto-pick from email)"
              autoFocus
              disabled={generating}
              className={`flex-1 ${textSize} bg-background border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !generating) {
                  e.preventDefault();
                  void generateAndInsertImage();
                } else if (e.key === "Escape") {
                  setGenPanelOpen(false);
                }
              }}
            />
            <select
              value={genRatio}
              onChange={(e) => setGenRatio(e.target.value as AspectRatio)}
              disabled={generating}
              className={`${smallText} bg-background border border-border rounded px-1.5 py-1 text-foreground focus:outline-none disabled:opacity-50`}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void generateAndInsertImage()}
              disabled={generating}
              className={`${smallText} px-2 py-1 rounded bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 transition-colors inline-flex items-center gap-1`}
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {generating ? "Generating…" : genPrompt.trim() ? "Generate" : "Auto-generate"}
            </button>
            <button
              type="button"
              onClick={() => { setGenPanelOpen(false); setGenPrompt(""); }}
              disabled={generating}
              className={`${smallText} px-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50`}
            >
              Close
            </button>
          </div>
          <p className={`${smallText} text-muted-foreground/80`}>
            Auto-grounded in your dataset + the email subject and body above. Click ✨ for an instant pick, or describe to refine. OpenAI · ~5–15s.
          </p>
        </div>
      )}

      {uploadError && (
        <div className={`${smallText} text-foreground bg-muted px-3 py-1.5 border-b border-border`}>
          {uploadError}
        </div>
      )}

      {showHtml && (
        <textarea
          value={htmlDraft}
          onChange={(e) => setHtmlDraft(e.target.value)}
          onBlur={() => onChange(htmlDraft)}
          disabled={disabled}
          rows={10}
          className={`w-full ${textSize} font-mono text-[10.8px] bg-background px-3 py-2 text-foreground focus:outline-none resize-y min-h-[180px] disabled:opacity-50`}
          placeholder={placeholder}
        />
      )}
      {showPreview && (
        <div className="bg-muted/20">
          <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-b border-border">
            <SegmentButton
              icon={Monitor}
              label="Desktop"
              active={previewWidth === "desktop"}
              onClick={() => setPreviewWidth("desktop")}
              smallText={smallText}
            />
            <SegmentButton
              icon={Smartphone}
              label="Mobile"
              active={previewWidth === "mobile"}
              onClick={() => setPreviewWidth("mobile")}
              smallText={smallText}
            />
          </div>
          <div className="p-3 flex justify-center">
            <iframe
              title="Email preview"
              sandbox=""
              className="bg-white border border-border rounded shadow-sm transition-all"
              style={{
                width: previewWidth === "desktop" ? "600px" : "375px",
                height: "560px",
                maxWidth: "100%",
              }}
              srcDoc={buildPreviewSrcDoc(value, imageContext?.subject)}
            />
          </div>
        </div>
      )}
      {viewMode === "edit" && (
        <div className={textSize}>
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}

function buildPreviewSrcDoc(bodyHtml: string, subject?: string): string {
  const safeSubject = (subject ?? "").replace(/[<>]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeSubject}</title>
  <style>
    body { margin: 0; padding: 16px; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0a0a0a; }
    .email-wrap { max-width: 100%; margin: 0 auto; background: #ffffff; padding: 28px; border-radius: 6px; box-sizing: border-box; }
    .email-wrap img { max-width: 100%; height: auto; }
    .email-wrap a { color: #0a0a0a; }
    .email-wrap h1, .email-wrap h2, .email-wrap h3 { line-height: 1.25; }
    .email-wrap p { line-height: 1.55; }
    .email-wrap hr { border: 0; border-top: 1px solid #e5e5e5; margin: 16px 0; }
    .preheader { color: #737373; font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="email-wrap">
    ${safeSubject ? `<div class="preheader">${safeSubject}</div>` : ""}
    ${bodyHtml || '<p style="color:#737373">Empty draft</p>'}
  </div>
</body>
</html>`;
}

interface ToolbarButtonProps {
  editor: Editor;
  onClick: () => void;
  isActive: boolean;
  icon: typeof Bold;
  label: string;
  disabled?: boolean;
  spinning?: boolean;
}

function ToolbarButton({ onClick, isActive, icon: Icon, label, disabled, spinning }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`p-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        isActive
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`} />
    </button>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-border mx-0.5" />;
}

interface ToolbarSelectProps {
  icon?: typeof Type;
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ label: string; value: string }>;
  disabled?: boolean;
  width?: string;
  smallText: string;
}

function ToolbarSelect({ icon: Icon, ariaLabel, value, onChange, options, disabled, width, smallText }: ToolbarSelectProps) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {Icon && <Icon className="w-3 h-3 text-muted-foreground/70 ml-1" />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`${smallText} ${width ?? ""} bg-transparent border border-border rounded px-1 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-40 cursor-pointer`}
      >
        {options.map((o) => (
          <option key={o.label + o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ColorButtonProps {
  editor: Editor;
  disabled?: boolean;
  smallText: string;
}

function ColorButton({ editor, disabled }: ColorButtonProps) {
  const [open, setOpen] = useState(false);
  const current = (editor.getAttributes("textStyle").color as string | undefined) ?? "";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Text color"
        aria-label="Text color"
        className={`p-1 rounded transition-colors disabled:opacity-40 ${
          open ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        <div className="relative">
          <Palette className="w-3.5 h-3.5" />
          {current && (
            <span
              className="absolute -bottom-0.5 left-0 right-0 h-[3px] rounded-sm"
              style={{ backgroundColor: current }}
            />
          )}
        </div>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-background border border-border rounded shadow-md p-1.5 grid grid-cols-5 gap-1">
          {TEXT_COLORS.map((c) => (
            <button
              key={c.label}
              type="button"
              title={c.label}
              onClick={() => {
                if (!c.value) editor.chain().focus().unsetColor().run();
                else editor.chain().focus().setColor(c.value).run();
                setOpen(false);
              }}
              className={`w-5 h-5 rounded border ${current === c.value ? "ring-1 ring-foreground" : "border-border"}`}
              style={{ backgroundColor: c.value ?? "transparent" }}
            >
              {!c.value && <span className="text-[7.2px] text-muted-foreground">×</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface SegmentButtonProps {
  icon: typeof Type;
  label: string;
  active: boolean;
  onClick: () => void;
  smallText: string;
  disabled?: boolean;
}

function SegmentButton({ icon: Icon, label, active, onClick, smallText, disabled }: SegmentButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`${smallText} px-1.5 py-1 rounded inline-flex items-center gap-1 transition-colors disabled:opacity-40 ${
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
