import { memo, useEffect, useMemo, useState } from "react";
import type { FileReadResult } from "@shared/types";
import type { Messages } from "./i18n";
import { MarkdownBody } from "./MarkdownBody";
import { highlightCode, languageLabel } from "./syntax";

type Props = {
  path: string;
  m: Messages;
  onClose: () => void;
  onInsertMention?: (path: string) => void;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileViewerInner({ path, m, onClose, onInsertMention }: Props) {
  const [data, setData] = useState<FileReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mdPreview, setMdPreview] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void window.desktop
      .readFile(path)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const isMarkdown =
    data?.language === "markdown" ||
    data?.ext === ".md" ||
    data?.ext === ".mdx" ||
    data?.ext === ".markdown";

  const lines = useMemo(() => {
    if (!data || data.binary || !data.content) return [] as string[];
    // Keep trailing empty line as one row if file ends with \n
    const parts = data.content.split("\n");
    if (parts.length > 1 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    return parts;
  }, [data]);

  const highlightedHtml = useMemo(() => {
    if (!data || data.binary) return "";
    return highlightCode(data.content, data.language);
  }, [data]);

  // Split highlighted HTML by lines — hljs may nest spans across lines.
  // Safer approach: highlight whole file then split on \n while tracking open tags
  // is complex. Simpler: line-number gutter + single pre with highlighted HTML.
  const lineCount = lines.length || (data?.content ? 1 : 0);

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <div className="file-viewer-meta">
          <span className="file-viewer-name" title={path}>
            {data?.name ?? path.split("/").pop() ?? path}
          </span>
          <span className="file-viewer-path">{path}</span>
        </div>
        <div className="file-viewer-actions">
          {data && !data.binary ? (
            <span className="file-viewer-chip">
              {languageLabel(data.language, data.ext)}
            </span>
          ) : null}
          {data ? (
            <span className="file-viewer-chip muted">
              {formatSize(data.size)}
            </span>
          ) : null}
          {isMarkdown && data && !data.binary ? (
            <button
              type="button"
              className="file-viewer-btn"
              onClick={() => setMdPreview((v) => !v)}
            >
              {mdPreview ? m.filesShowSource : m.filesShowPreview}
            </button>
          ) : null}
          {onInsertMention ? (
            <button
              type="button"
              className="file-viewer-btn"
              title={m.filesInsertMention}
              onClick={() => onInsertMention(path)}
            >
              @
            </button>
          ) : null}
          <button
            type="button"
            className="file-viewer-btn close"
            onClick={onClose}
            aria-label={m.filesClose}
            title={m.filesClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="file-viewer-body">
        {loading ? (
          <div className="file-viewer-empty">{m.filesLoading}</div>
        ) : null}
        {error ? (
          <div className="file-viewer-empty error">{error}</div>
        ) : null}
        {data?.binary && data.imageMime && data.imageBase64 ? (
          <div className="file-viewer-image-wrap">
            <img
              className="file-viewer-image"
              src={`data:${data.imageMime};base64,${data.imageBase64}`}
              alt={data.name}
              title={data.path}
            />
            {data.truncated ? (
              <div className="file-viewer-truncated">
                {m.filesImageTruncated.replace(
                  "{size}",
                  formatSize(data.size),
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {data?.binary && !(data.imageMime && data.imageBase64) ? (
          <div className="file-viewer-empty">
            {m.filesBinary}
            <div className="file-viewer-sub">
              {formatSize(data.size)} · {data.name}
            </div>
          </div>
        ) : null}
        {data && !data.binary && !loading && !error ? (
          isMarkdown && mdPreview ? (
            <div className="file-viewer-md">
              <MarkdownBody text={data.content || " "} />
            </div>
          ) : (
            <div className="file-viewer-code-wrap">
              <div className="file-viewer-gutter" aria-hidden>
                {Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <pre className="file-viewer-code hljs">
                <code
                  className={`language-${data.language}`}
                  dangerouslySetInnerHTML={{
                    __html: highlightedHtml || "\u00a0",
                  }}
                />
              </pre>
            </div>
          )
        ) : null}
        {data?.truncated ? (
          <div className="file-viewer-truncated">{m.filesTruncated}</div>
        ) : null}
      </div>
    </div>
  );
}

export const FileViewer = memo(FileViewerInner);
