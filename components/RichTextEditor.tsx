"use client";

import dynamic from "next/dynamic";
import { forwardRef, useImperativeHandle, useMemo, useRef, type ComponentType, type Ref } from "react";
import "react-quill/dist/quill.snow.css";

/*
  Quill touches `document` at import time, so it can only load in the browser. react-quill's
  bundled types don't line up cleanly with next/dynamic's ref/module typing, so the loaded
  component is typed loosely here rather than fighting that mismatch.
*/
interface LooseQuillProps {
  ref?: Ref<unknown>;
  theme: string;
  value: string;
  onChange: (html: string) => void;
  modules: Record<string, unknown>;
}
const ReactQuill = dynamic(() => import("react-quill"), { ssr: false }) as unknown as ComponentType<LooseQuillProps>;

interface QuillSelection {
  index: number;
  length: number;
}
interface QuillInstance {
  getSelection: (focus?: boolean) => QuillSelection | null;
  insertText: (index: number, text: string) => void;
  clipboard: { dangerouslyPasteHTML: (index: number, html: string) => void };
  setSelection: (index: number, length?: number) => void;
}
interface ReactQuillInstance {
  getEditor: () => QuillInstance;
}

const BASIC_TABLE_HTML =
  '<table style="border-collapse:collapse;width:100%"><tbody>' +
  '<tr><td style="border:1px solid #cbd5e1;padding:6px">Cell 1</td><td style="border:1px solid #cbd5e1;padding:6px">Cell 2</td></tr>' +
  '<tr><td style="border:1px solid #cbd5e1;padding:6px">Cell 3</td><td style="border:1px solid #cbd5e1;padding:6px">Cell 4</td></tr>' +
  "</tbody></table><p><br></p>";

export interface RichTextEditorHandle {
  /** Inserts plain text at the current cursor position (or the end if nothing is selected). */
  insertAtCursor: (text: string) => void;
}

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  { value: string; onChange: (html: string) => void; logoUrl?: string }
>(function RichTextEditor({ value, onChange, logoUrl }, ref) {
  const quillRef = useRef<ReactQuillInstance | null>(null);
  const logoUrlRef = useRef(logoUrl);
  logoUrlRef.current = logoUrl;

  useImperativeHandle(ref, () => ({
    insertAtCursor: (text: string) => {
      const editor = quillRef.current?.getEditor();
      if (!editor) return;
      const selection = editor.getSelection(true);
      const index = selection ? selection.index : 0;
      editor.insertText(index, text);
      editor.setSelection(index + text.length, 0);
    },
  }));

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [false, 1, 2, 3] }],
          [{ font: [] }],
          ["bold", "italic", "underline"],
          [{ color: [] }, { background: [] }],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["link", "image"],
          ["insertTable", "insertHr", "insertLogo"],
          ["clean"],
        ],
        handlers: {
          insertTable(this: { quill: QuillInstance }) {
            const selection = this.quill.getSelection(true);
            const index = selection ? selection.index : 0;
            this.quill.clipboard.dangerouslyPasteHTML(index, BASIC_TABLE_HTML);
          },
          insertHr(this: { quill: QuillInstance }) {
            const selection = this.quill.getSelection(true);
            const index = selection ? selection.index : 0;
            this.quill.clipboard.dangerouslyPasteHTML(index, "<hr /><p><br></p>");
          },
          insertLogo(this: { quill: QuillInstance }) {
            const url = logoUrlRef.current;
            if (!url) {
              window.alert("Set a Company Logo URL in the Company Branding panel first.");
              return;
            }
            const selection = this.quill.getSelection(true);
            const index = selection ? selection.index : 0;
            this.quill.clipboard.dangerouslyPasteHTML(index, `<img src="${url}" style="max-height:48px" /><p><br></p>`);
          },
        },
      },
    }),
    []
  );

  return (
    <div className="rounded-lg border border-slate-300 bg-white [&_.ql-toolbar]:rounded-t-lg [&_.ql-container]:rounded-b-lg [&_.ql-container]:min-h-[160px]">
      <ReactQuill ref={quillRef as Ref<unknown>} theme="snow" value={value} onChange={onChange} modules={modules} />
    </div>
  );
});
