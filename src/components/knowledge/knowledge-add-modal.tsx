"use client";

import { useState, useRef, useCallback } from "react";
import {
  X,
  Upload,
  FileText,
  PenLine,
  ClipboardPaste,
  Link,
  FileSpreadsheet,
  Code,
} from "lucide-react";

type AddAction = "write" | "paste" | "upload" | "url" | "notion";

interface KnowledgeAddModalProps {
  onSelect: (action: AddAction, file?: File) => void;
  onClose: () => void;
}

export function KnowledgeAddModal({ onSelect, onClose }: KnowledgeAddModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      onSelect("upload", file);
    },
    [onSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background rounded-lg border border-border shadow-lg w-full max-w-3xl mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-6 pb-1">
          <div>
            <h2 className="text-lg font-semibold">Import Content</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add knowledge entries from files, text, or external sources.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div className="px-7 pt-5 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.csv,.json,.html,.htm,.pdf,.docx"
            onChange={handleFileInput}
            className="hidden"
          />
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center py-12 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
              isDragging
                ? "border-foreground/40 bg-muted"
                : "border-border bg-muted/40 hover:border-foreground/20 hover:bg-muted/60"
            }`}
          >
            <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center mb-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Import your content</p>
            <p className="text-xs text-muted-foreground mt-1.5">
              Drag and drop CSV, PDF, text, markdown, or HTML files, or{" "}
              <span className="text-foreground underline underline-offset-2">choose a file</span>
            </p>
          </div>
        </div>

        {/* File-based imports */}
        <div className="px-7 pt-5 pb-3">
          <p className="text-sm text-muted-foreground mb-3">
            File-based imports
          </p>
          <div className="grid grid-cols-4 gap-2.5">
            <ImportCard
              icon={FileSpreadsheet}
              title="CSV"
              description="Import structured data from spreadsheets."
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = ".csv";
                  fileInputRef.current.click();
                  fileInputRef.current.accept = ".md,.markdown,.txt,.csv,.json,.html,.htm,.pdf,.docx";
                }
              }}
            />
            <ImportCard
              icon={FileText}
              title="PDF"
              description="Extract content from PDF documents."
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = ".pdf";
                  fileInputRef.current.click();
                  fileInputRef.current.accept = ".md,.markdown,.txt,.csv,.json,.html,.htm,.pdf,.docx";
                }
              }}
            />
            <ImportCard
              icon={PenLine}
              title="Text & Markdown"
              description="Import plain text and formatted notes."
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = ".txt,.md,.markdown";
                  fileInputRef.current.click();
                  fileInputRef.current.accept = ".md,.markdown,.txt,.csv,.json,.html,.htm,.pdf,.docx";
                }
              }}
            />
            <ImportCard
              icon={Code}
              title="HTML"
              description="Import web pages and structured content."
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.accept = ".html,.htm";
                  fileInputRef.current.click();
                  fileInputRef.current.accept = ".md,.markdown,.txt,.csv,.json,.html,.htm,.pdf,.docx";
                }
              }}
            />
          </div>
        </div>

        {/* Product integrations */}
        <div className="px-7 pt-3 pb-3">
          <p className="text-sm text-muted-foreground mb-3">
            Integrations
          </p>
          <div className="grid grid-cols-4 gap-2.5">
            <ImportCard
              logo={<NotionLogo />}
              title="Notion"
              description="Import from your Notion workspace."
              onClick={() => onSelect("notion")}
            />
            <ImportCard
              logo={<ConfluenceLogo />}
              title="Confluence"
              description="Import pages from Confluence wiki."
              onClick={() => onSelect("url")}
            />
            <ImportCard
              logo={<GoogleDocsLogo />}
              title="Google Docs"
              description="Import from Google Docs and Sheets."
              onClick={() => onSelect("url")}
            />
            <ImportCard
              logo={<CodaLogo />}
              title="Coda"
              description="Import docs and tables from Coda."
              onClick={() => onSelect("url")}
            />
          </div>
        </div>

        {/* Other import methods */}
        <div className="px-7 pt-3 pb-6">
          <p className="text-sm text-muted-foreground mb-3">
            Other sources
          </p>
          <div className="grid grid-cols-4 gap-2.5">
            <ImportCard
              icon={PenLine}
              title="Write"
              description="Write a new knowledge entry directly."
              onClick={() => onSelect("write")}
            />
            <ImportCard
              icon={ClipboardPaste}
              title="Paste Text"
              description="Paste text to extract knowledge entries."
              onClick={() => onSelect("paste")}
            />
            <ImportCard
              icon={Link}
              title="From URL"
              description="Import content from any web page."
              onClick={() => onSelect("url")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportCard({
  icon: Icon,
  logo,
  title,
  description,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  logo?: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 p-3.5 border border-border rounded-lg text-left transition-colors hover:bg-muted/50 cursor-pointer"
    >
      {logo ? logo : Icon ? <Icon className="w-5 h-5 text-muted-foreground" /> : null}
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[9.9px] text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
    </button>
  );
}

/* ── Product logos ── */

function NotionLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 100 100" fill="none">
      <path d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z" fill="currentColor"/>
      <path d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.433-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.86-2.837-3.443-4.733L75.24 3.727C70.98.807 69.087-.28 62.467.26l-1.117-.033z" fill="currentColor"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M28.267 17.667c-4.853.393-5.967.48-8.74-1.64L12.3 10.523c-.727-.58-1.163-1.357-.387-1.553l53.667-4.083c4.467-.393 6.793.973 8.54 2.333l8.717 6.29c.393.193.97 1.167.193 1.167l-55.543 3.24-.22-.25zM34 93.527V30.56c0-2.53.78-3.697 3.113-3.89L86 23.777c2.137-.193 3.11 1.167 3.11 3.697v62.58c0 2.53-.39 4.667-3.887 4.86l-47.333 2.723c-3.5.193-4.89-.973-4.89-4.11zm47.333-60.077c.393 1.75 0 3.5-1.75 3.697l-2.333.39V90.8c-2.137 1.167-4.083 1.75-5.637 1.75-2.72 0-3.5-.973-5.443-3.5L48.5 63.473v24.027l5.833 1.363s0 3.5-4.86 3.5L36.833 93.14c-.393-.78 0-2.723 1.357-3.11l3.5-.973V53.86l-4.857-.39c-.393-1.75.583-4.277 3.31-4.473l14.163-.973 15.943 24.42V50.86l-4.857-.583c-.393-2.14 1.163-3.694 3.11-3.887l14.83-.94z" fill="var(--color-background)"/>
    </svg>
  );
}

function ConfluenceLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 256 246" fill="none">
      <path d="M9.26 187.75c-3.68 6.08-7.92 13.16-10.8 18.08a6.27 6.27 0 002.24 8.56l53.72 32.24a6.28 6.28 0 008.56-2.08c2.56-4.36 6.24-10.72 10.32-17.68 22.96-39.2 46.08-34.64 88-14.96l52.56 24.56a6.28 6.28 0 008.24-3.2l24.24-54.16a6.27 6.27 0 00-3.12-8.24c-15.36-7.04-45.92-21.12-64.72-29.84-65.64-30.48-119.44-27.2-169.24 46.72z" fill="#1868DB"/>
      <path d="M246.74 57.45c3.68-6.08 7.92-13.16 10.8-18.08a6.27 6.27 0 00-2.24-8.56L201.58-1.43a6.28 6.28 0 00-8.56 2.08c-2.56 4.36-6.24 10.72-10.32 17.68-22.96 39.2-46.08 34.64-88 14.96L42.14 8.73a6.28 6.28 0 00-8.24 3.2L9.66 66.09a6.27 6.27 0 003.12 8.24c15.36 7.04 45.92 21.12 64.72 29.84 65.68 30.52 119.48 27.24 169.24-46.72z" fill="#1868DB"/>
    </svg>
  );
}

function GoogleDocsLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
      <path d="M29 4H14a3 3 0 00-3 3v34a3 3 0 003 3h20a3 3 0 003-3V12L29 4z" fill="#4285F4"/>
      <path d="M29 4v8h8L29 4z" fill="#A1C2FA"/>
      <path d="M18 24h12v2H18v-2zm0 4h12v2H18v-2zm0 4h8v2h-8v-2z" fill="white"/>
    </svg>
  );
}

function CodaLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 55 55" fill="none">
      <path d="M27.5 0C12.312 0 0 12.312 0 27.5S12.312 55 27.5 55c4.313 0 7.813-3.5 7.813-7.813v-.624c0-2.063-.813-4.063-2.313-5.5a7.713 7.713 0 01-2.25-5.438 7.813 7.813 0 017.813-7.813h4.374C49.25 27.813 55 22.062 55 15.75 55 7.063 42.688 0 27.5 0z" fill="#F76540"/>
      <circle cx="14" cy="22" r="5" fill="#FFA726"/>
      <circle cx="22" cy="12" r="5" fill="#FDD835"/>
      <circle cx="33" cy="12" r="5" fill="#66BB6A"/>
      <circle cx="41" cy="22" r="5" fill="#29B6F6"/>
    </svg>
  );
}
