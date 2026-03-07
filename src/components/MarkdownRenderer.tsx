import {
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface MarkdownRendererProps {
  content: string;
  isDark?: boolean;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toThinkDetails = (rawBody: string) => {
  const body = String(rawBody || "").trim();
  if (!body) return "";
  return `<details class="think-block"><summary>思考过程</summary><pre>${escapeHtml(
    body
  )}</pre></details>`;
};

const tryWrapImplicitThinking = (content: string) => {
  const trimmed = String(content || "").trim();
  if (!trimmed || /<details class="think-block">/i.test(trimmed)) {
    return trimmed;
  }

  const cuePattern =
    /(Interpreting the Query|Clarifying|Confirming|I need to|I'm currently|I should|根据我的系统提示|我需要|首先|接下来|用户问|用户用中文说)/gi;
  const cueCount = (trimmed.match(cuePattern) || []).length;
  if (cueCount < 2) return trimmed;

  const blocks = trimmed
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (blocks.length < 2) return trimmed;

  const answerBlock = blocks[blocks.length - 1];
  const answerLikePattern =
    /^(你好|您好|我是|很高兴|请问|有什么我可以|好的|当然|Hello|Hi|Sure|I am|I'm)/i;
  const answerLooksValid =
    (answerLikePattern.test(answerBlock) && answerBlock.length <= 260) ||
    (answerBlock.length <= 180 && /[。！？!?]$/.test(answerBlock));
  if (answerLooksValid) {
    const thinkBody = blocks.slice(0, -1).join("\n\n").trim();
    if (!thinkBody || thinkBody.length < 80) return trimmed;
    if (thinkBody.length < answerBlock.length * 1.2) return trimmed;
    return `<think>\n${thinkBody}\n</think>\n\n${answerBlock}`;
  }

  // 同一段里混入“最后回复”的场景：按结尾问候/自我介绍锚点拆分
  const pivotPattern =
    /(?:^|\n|[。！？!?]\s*)(你好|您好|我是|Hello|Hi|Sure|当然|好的)/g;
  const matches = [...trimmed.matchAll(pivotPattern)];
  if (!matches.length) return trimmed;

  const last = matches[matches.length - 1];
  const pivot = last.index ?? -1;
  if (pivot <= 0) return trimmed;

  const thinkBody = trimmed.slice(0, pivot).trim();
  const answerBody = trimmed.slice(pivot).trim();
  if (!thinkBody || !answerBody) return trimmed;
  if (thinkBody.length < 100 || answerBody.length > 320) return trimmed;
  if (!/(我需要|应该|用户|首先|接下来|最后)/.test(thinkBody)) return trimmed;

  return `<think>\n${thinkBody}\n</think>\n\n${answerBody}`;
};

const normalizeThinkingBlocks = (rawContent: string) => {
  if (!rawContent) return rawContent;

  let normalized = rawContent;

  normalized = normalized.replace(
    /```(?:think|thinking|reasoning|analysis)\s*([\s\S]*?)```/gi,
    (_, body) => `<think>\n${body}\n</think>`
  );
  normalized = normalized.replace(
    /<(thinking|reasoning|analysis)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (_, _tag, body) => `<think>\n${body}\n</think>`
  );
  normalized = normalized.replace(
    /\[(?:think|thinking|reasoning|analysis)\]([\s\S]*?)\[\/(?:think|thinking|reasoning|analysis)\]/gi,
    (_, body) => `<think>\n${body}\n</think>`
  );
  normalized = normalized.replace(
    /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>/gi,
    (_, body) => toThinkDetails(body)
  );

  normalized = tryWrapImplicitThinking(normalized).replace(
    /<think(?:\s[^>]*)?>([\s\S]*?)<\/think>/gi,
    (_, body) => toThinkDetails(body)
  );

  return normalized;
};

function CodeBlock({
  language,
  children,
  isDark,
}: {
  language: string;
  children: string;
  isDark: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isHtml = language?.toLowerCase() === "html";

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-lang">{language || "text"}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {isHtml && (
            <Tooltip title={preview ? "查看代码" : "实时预览"}>
              <Button
                type="text"
                size="small"
                icon={preview ? <CodeOutlined /> : <EyeOutlined />}
                onClick={() => setPreview(!preview)}
                className="copy-btn"
              />
            </Tooltip>
          )}
          <Tooltip title={copied ? "已复制！" : "复制代码"}>
            <Button
              type="text"
              size="small"
              icon={
                copied ? (
                  <CheckOutlined style={{ color: "#52c41a" }} />
                ) : (
                  <CopyOutlined />
                )
              }
              onClick={handleCopy}
              className="copy-btn"
            />
          </Tooltip>
        </div>
      </div>
      {preview && isHtml ? (
        <div
          style={{
            background: "#fff",
            borderRadius: "0 0 8px 8px",
            padding: "8px",
            height: "350px",
            overflow: "hidden",
          }}
        >
          <iframe
            srcDoc={children}
            style={{ width: "100%", height: "100%", border: "none" }}
            title="Artifact Preview"
            sandbox="allow-scripts"
          />
        </div>
      ) : (
        <SyntaxHighlighter
          style={isDark ? oneDark : oneLight}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: "0 0 8px 8px",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
        >
          {children}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

export const MarkdownRenderer = ({
  content,
  isDark = false,
}: MarkdownRendererProps) => {
  const normalizedContent = useMemo(
    () => normalizeThinkingBlocks(content),
    [content]
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath] as any[]}
      rehypePlugins={[rehypeKatex, rehypeRaw] as any[]}
      className="md-content"
      components={{
        code(props: any) {
          const { children, className, node, ...rest } = props;
          const match = /language-(\w+)/.exec(className || "");
          const isBlock =
            node?.position?.start?.line !== node?.position?.end?.line ||
            String(children).includes("\n");

          if (match || isBlock) {
            return (
              <CodeBlock language={match?.[1] || ""} isDark={isDark}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          }
          return (
            <code {...rest} className="inline-code">
              {children}
            </code>
          );
        },
        table({ children }) {
          return (
            <div className="table-wrapper">
              <table>{children}</table>
            </div>
          );
        },
        a({ children, href }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {normalizedContent}
    </ReactMarkdown>
  );
};
