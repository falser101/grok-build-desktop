import { memo, useMemo } from "react";
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

  // While tokens stream, skip full remark/GFM parse (O(n) per chunk). Plain
  // text keeps the caret smooth; markdown is applied once the turn settles.
  if (streaming) {
    return (
      <div className={cls}>
        <div className="md-streaming-plain">{source}</div>
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
