import {
  Children,
  isValidElement,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePrefs } from "./PrefsContext";
import { copyText } from "./timelineMarkdown";

const remarkPlugins = [remarkGfm];

/** Convert `@relative/path` mentions in plain text to markdown links
 *  so react-markdown renders them as clickable elements. The custom
 *  `a` component below intercepts `at-file://` URLs to style them
 *  as file pills. */
function preprocessAtFiles(text: string): string {
  return text.replace(
    /(^|\s)@([^\s@]+)/g,
    (_full, space: string, path: string) =>
      `${space}[@${path}](at-file://${encodeURIComponent(path)})`,
  );
}

type CopyState = "idle" | "ok" | "err";

/** Walk any React tree and concatenate all string/number leaves. */
function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * Wraps a parsed <pre><code> block with a floating copy button. react-markdown
 * always passes the rendered <code> element as the only child of <pre>, so we
 * extract its raw text and forward its className/style verbatim.
 */
function CodeBlock({
  raw,
  codeClassName,
  codeStyle,
  children,
}: {
  raw: string;
  codeClassName?: string;
  codeStyle?: CSSProperties;
  children: ReactNode;
}) {
  const { messages: m } = usePrefs();
  const [state, setState] = useState<CopyState>("idle");

  const onCopy = useCallback(async () => {
    if (!raw) return;
    try {
      await copyText(raw);
      setState("ok");
    } catch {
      setState("err");
    }
    window.setTimeout(() => setState("idle"), 1600);
  }, [raw]);

  const label =
    state === "ok" ? m.copied : state === "err" ? m.copyFailed : m.copyMessage;
  const disabled = !raw;

  return (
    <div className="md-pre-wrap">
      <button
        type="button"
        className={`md-pre-copy${state === "ok" ? " is-ok" : ""}${
          state === "err" ? " is-err" : ""
        }`}
        onClick={() => void onCopy()}
        title={label}
        aria-label={label}
        disabled={disabled}
      >
        {state === "ok" ? (
          <span className="md-pre-copy-label">{m.copied}</span>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <pre className="md-pre">
        <code className={codeClassName} style={codeStyle}>
          {children}
        </code>
      </pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
  pre: ({ children }) => {
    // react-markdown always emits a single <code> child here. Extract its
    // raw text for the copy button and pass through className/style.
    const arr = Children.toArray(children);
    const codeEl = arr.find(
      (c): c is ReactElement<{
        className?: string;
        style?: CSSProperties;
        children?: ReactNode;
      }> => isValidElement(c) && c.type === "code",
    );
    const raw = codeEl
      ? nodeToText(codeEl.props.children)
      : nodeToText(children);
    return (
      <CodeBlock
        raw={raw}
        codeClassName={codeEl?.props.className}
        codeStyle={codeEl?.props.style}
      >
        {codeEl ? codeEl.props.children : children}
      </CodeBlock>
    );
  },
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
  /** Called when the user clicks an @-mentioned file path. */
  onOpenAtFile?: (path: string) => void;
};

/**
 * Cap how often a streaming update propagates to downstream ReactMarkdown /
 * remark re-parses. The renderer gets one update per animation frame (≈16ms)
 * during token storms, regardless of how many raw events fire.
 */
function useFrameThrottledValue<T>(value: T): T {
  const ref = useRef(value);
  const [pending, setPending] = useState<T>(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === ref.current) return;
    ref.current = value;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPending(ref.current);
    });
    return () => {
      // No-op cleanup; flush happens on the next pending set.
    };
  }, [value]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  return pending;
}

function MarkdownBodyInner({ text, className, streaming, onOpenAtFile }: Props) {
  const cls = [className, "md-body", streaming ? "streaming" : ""]
    .filter(Boolean)
    .join(" ");

  const rawSource = useMemo(() => text || "\u00a0", [text]);
  // Convert @-mention patterns to markdown links ahead of parsing.
  const source = useMemo(
    () => preprocessAtFiles(rawSource),
    [rawSource],
  );

  const displaySource = useFrameThrottledValue(source);
  const deferredSource = useDeferredValue(displaySource);

  const atFileComponents: Components = useMemo(
    () => ({
      ...components,
      a: ({ href, children, ...props }: any) => {
        if (typeof href === "string" && href.startsWith("at-file://")) {
          const path = decodeURIComponent(href.slice("at-file://".length));
          return (
            <span
              className="at-file-link"
              onClick={(e) => {
                e.preventDefault();
                onOpenAtFile?.(path);
              }}
              title={path}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenAtFile?.(path);
              }}
            >
              {children}
            </span>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
            {children}
          </a>
        );
      },
    }),
    [onOpenAtFile],
  );

  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={atFileComponents}>
        {deferredSource}
      </ReactMarkdown>
      {streaming ? <span className="md-streaming-caret" aria-hidden>▍</span> : null}
    </div>
  );
}

export const MarkdownBody = memo(MarkdownBodyInner);