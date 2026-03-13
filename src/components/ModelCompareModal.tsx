import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { createAuthHeaders, resolveApiUrl } from "@/services/request";
import {
  CopyOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  message as antdMessage,
  Button,
  Divider,
  Empty,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import { useRef, useState } from "react";

interface CompareResult {
  model: string;
  displayName: string;
  content: string;
  loading: boolean;
  error?: string;
}

interface ModelCompareModalProps {
  open: boolean;
  onClose: () => void;
  models: API.Model[];
  conversationId: string | null;
  isDark: boolean;
}

export const ModelCompareModal = ({
  open,
  onClose,
  models,
  conversationId,
  isDark,
}: ModelCompareModalProps) => {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const abortRefs = useRef<AbortController[]>([]);

  const handleRun = async () => {
    if (!prompt.trim() || selectedModels.length < 2) return;

    setRunning(true);
    const initialResults: CompareResult[] = selectedModels.map((m) => ({
      model: m,
      displayName: models.find((mo) => mo.model_id === m)?.display_name || m,
      content: "",
      loading: true,
    }));
    setResults(initialResults);
    abortRefs.current = selectedModels.map(() => new AbortController());

    await Promise.all(
      selectedModels.map(async (modelId, idx) => {
        try {
          const convId = conversationId;
          if (!convId) return;

          const response = await fetch(
            resolveApiUrl(`/api/conversations/${convId}/chat`),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...createAuthHeaders(),
              },
              body: JSON.stringify({
                message: prompt,
                model: modelId,
                _compare: true,
              }),
              signal: abortRefs.current[idx].signal,
            }
          );

          if (!response.ok) throw new Error("Network error");
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk
              .split("\n")
              .filter((l) => l.startsWith("data: "));
            for (const line of lines) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  setResults((prev) =>
                    prev.map((r, i) =>
                      i === idx
                        ? {
                            ...r,
                            content: r.content + parsed.content,
                            loading: false,
                          }
                        : r
                    )
                  );
                }
                if (parsed.error) {
                  setResults((prev) =>
                    prev.map((r, i) =>
                      i === idx
                        ? { ...r, error: parsed.error, loading: false }
                        : r
                    )
                  );
                }
              } catch (_) {}
            }
          }
        } catch (error: any) {
          if (error.name !== "AbortError") {
            setResults((prev) =>
              prev.map((r, i) =>
                i === idx ? { ...r, error: error.message, loading: false } : r
              )
            );
          }
        }
        setResults((prev) =>
          prev.map((r, i) => (i === idx ? { ...r, loading: false } : r))
        );
      })
    );

    setRunning(false);
  };

  const handleStop = () => {
    abortRefs.current.forEach((c) => c.abort());
    setRunning(false);
    setResults((prev) => prev.map((r) => ({ ...r, loading: false })));
  };

  const handleCopy = (content: string, model: string) => {
    navigator.clipboard.writeText(content);
    antdMessage.success(`已复制 ${model} 的回答`);
  };

  return (
    <Modal
      title={
        <span>
          <ThunderboltOutlined style={{ color: "#f59e0b", marginRight: 8 }} />
          多模型并行对比
        </span>
      }
      open={open}
      onCancel={onClose}
      width={Math.min(1200, window.innerWidth - 40)}
      footer={null}
      styles={{ body: { maxHeight: "80vh", overflowY: "auto" } }}
    >
      {/* 配置区 */}
      <div
        style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}
      >
        <Select
          mode="multiple"
          placeholder="选择 2-4 个模型进行对比"
          style={{ flex: 1, minWidth: 240 }}
          options={models.map((m) => ({
            label: m.display_name,
            value: m.model_id,
          }))}
          value={selectedModels}
          onChange={(vals) => setSelectedModels(vals.slice(0, 4))}
          maxTagCount={4}
        />
        {running ? (
          <Button danger icon={<StopOutlined />} onClick={handleStop}>
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleRun}
            disabled={
              selectedModels.length < 2 || !prompt.trim() || !conversationId
            }
          >
            开始对比
          </Button>
        )}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="输入要对比的问题或提示词..."
        style={{
          width: "100%",
          minHeight: 80,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #d1d5db",
          fontSize: 14,
          fontFamily: "inherit",
          resize: "vertical",
          background: isDark ? "#1e293b" : "#fff",
          color: isDark ? "#f9fafb" : "#111827",
          marginBottom: 16,
        }}
      />

      {selectedModels.length < 2 && (
        <div
          style={{
            color: "#9ca3af",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          请至少选择 2 个模型
        </div>
      )}

      {/* 对比结果区 */}
      {results.length > 0 && (
        <>
          <Divider />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(
                results.length,
                2
              )}, 1fr)`,
              gap: 16,
            }}
          >
            {results.map((r, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: isDark ? "#1e293b" : "#f9fafb",
                }}
              >
                {/* 模型标题栏 */}
                <div
                  style={{
                    padding: "8px 14px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: isDark ? "#0f172a" : "#f3f4f6",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Tag color="blue" style={{ margin: 0 }}>
                      {r.displayName}
                    </Tag>
                    {r.loading && <Spin size="small" />}
                  </div>
                  {r.content && (
                    <Tooltip title="复制">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => handleCopy(r.content, r.displayName)}
                      />
                    </Tooltip>
                  )}
                </div>
                {/* 内容区 */}
                <div style={{ padding: "12px 16px", minHeight: 120 }}>
                  {r.error ? (
                    <span style={{ color: "#ef4444", fontSize: 13 }}>
                      ❌ {r.error}
                    </span>
                  ) : r.content ? (
                    <MarkdownRenderer content={r.content} isDark={isDark} />
                  ) : r.loading ? (
                    <div style={{ color: "#9ca3af", fontSize: 13 }}>
                      生成中...
                    </div>
                  ) : (
                    <Empty description="暂无内容" imageStyle={{ height: 40 }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};
