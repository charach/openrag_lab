/**
 * Auto-Pilot wizard — three-step happy path for non-experts:
 *  1) pick a preset based on the host hardware,
 *  2) create a workspace + upload documents,
 *  3) start indexing and watch the progress over WebSocket.
 *
 * The flow is intentionally linear — no skipping ahead — to keep
 * non-experts from creating an inconsistent state.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  type IndexAcceptedResponse,
  type PresetResponse,
  type SystemProfileResponse,
} from "../api/client";
import { useWebSocket, type WSMessage } from "../hooks/useWebSocket";
import { useWorkspaceStore } from "../stores/workspace";

type PresetEntry = PresetResponse["presets"][number];

export function AutoPilotWizard(): JSX.Element {
  const [profile, setProfile] = useState<SystemProfileResponse | null>(null);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("내 자료실");
  const [files, setFiles] = useState<File[]>([]);
  const [task, setTask] = useState<IndexAcceptedResponse | null>(null);
  const [progress, setProgress] = useState<WSMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    api.systemProfile().then(setProfile).catch((e) => setError(String(e)));
    api.systemPresets().then((r) => {
      setPresets(r.presets);
      const recommended = r.presets.find((p) => p.recommended);
      if (recommended) setChosen(recommended.id);
    });
  }, []);

  const topics = useMemo(
    () => (task ? [task.websocket_topic] : []),
    [task],
  );
  useWebSocket({
    topics,
    enabled: task !== null,
    onMessage: (m) => setProgress(m),
  });

  const launch = async (): Promise<void> => {
    setError(null);
    const preset = presets.find((p) => p.id === chosen);
    if (!preset) {
      setError("preset not chosen");
      return;
    }
    try {
      const ws = await api.createWorkspace(workspaceName, preset.id);
      setActiveWorkspace(ws.id);
      if (files.length > 0) {
        await api.uploadDocuments(ws.id, files);
      }
      const accepted = await api.startIndex(ws.id, {
        config: {
          embedder_id: preset.config.embedder_id,
          chunking: preset.config.chunking,
          retrieval_strategy: preset.config.retrieval_strategy,
          top_k: preset.config.top_k,
          llm_id: preset.config.llm_id,
        },
      });
      setTask(accepted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="autopilot">
      <h2>Auto-Pilot</h2>
      <p>
        시스템: {profile ? `${profile.os.platform}/${profile.gpu.acceleration_backend}` : "..."}
      </p>

      <fieldset>
        <legend>1단계 — 프리셋 선택</legend>
        {presets.map((p) => (
          <label key={p.id} style={{ display: "block" }}>
            <input
              type="radio"
              checked={chosen === p.id}
              onChange={() => setChosen(p.id)}
              name="preset"
              disabled={!p.available}
            />
            {p.name} {p.recommended ? "★" : ""} —{" "}
            <small>{p.rationale}</small>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>2단계 — 워크스페이스</legend>
        <label>
          이름:
          <input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        </label>
        <input
          type="file"
          multiple
          onChange={(e) =>
            setFiles(e.target.files ? Array.from(e.target.files) : [])
          }
        />
      </fieldset>

      <button onClick={launch} disabled={chosen === null || workspaceName.length === 0}>
        시작
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {task && (
        <article>
          <h3>인덱싱 진행</h3>
          <p>task_id: {task.task_id}</p>
          <p>experiment_id: {task.experiment_id}</p>
          <p>
            현재: {progress ? `${progress.type} ${(progress.ratio as number) ?? ""}` : "대기"}
          </p>
          <Link to="/chat">→ 채팅으로 가기</Link>
        </article>
      )}
    </section>
  );
}
