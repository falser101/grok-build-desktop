import { memo, useDeferredValue, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins = [remarkGfm];

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="md-pre">{children}</pre>,
  code: ({ className, children, ...props }) => {
    const isBlock =
      Boolean(className?.includes("language-")) ||
      (typeof children === "string" && children.includes("\n"));
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

type Props = {
  text: string;
  className?: string;
  streaming?: boolean;
};

function MarkdownBodyInner({ text, className, streaming }: Props) {
  const cls = [className, "md-body", streaming ? "streaming" : ""]
    .filter(Boolean)
    .join(" ");

  // Stable empty fallback so streaming "" still shows caret via CSS.
  const source = useMemo(() => text || "\u00a0", [text]);

  // Parse markdown incrementally while tokens stream. useDeferredValue lets
  // React coalesce frequent token updates into a single render pass behind a
  // high-priority overlay (the caret text), so the caret stays smooth even
  // when remark is busy on a long chunk.
  const deferredSource = useDeferredValue(source);

  if (streaming) {
    // Two-layer overlay while streaming:
    //  - foreground: the freshest token text with a blinking caret
    //  - background: the (slightly stale) parsed markdown so headings, code
    //    blocks, lists and links render in real time instead of appearing
    //    all at once when the turn ends.
    return (
      <div className={cls}>
        <div className="md-body md-deferred" aria-hidden="true">
          <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
            {deferredSource}
          </ReactMarkdown>
        </div>
        <div className="md-streaming-fresh">{source}</div>
      </div>
    );
  }

  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyInner);
