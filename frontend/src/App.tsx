/**
 * Top-level shell — four-screen MVP wired through React Router.
 * Each route maps to one of the wizard / chat / chunking / matrix views
 * referenced in TODO.md Phase 3.
 */

import { Link, Route, Routes } from "react-router-dom";
import { AutoPilotWizard } from "./screens/AutoPilotWizard";
import { ChatView } from "./screens/ChatView";
import { ChunkingLab } from "./screens/ChunkingLab";
import { ExperimentMatrix } from "./screens/ExperimentMatrix";

export function App(): JSX.Element {
  return (
    <main>
      <header>
        <h1>OpenRAG-Lab</h1>
        <nav>
          <Link to="/">Auto-Pilot</Link> |{" "}
          <Link to="/chunking">Chunking Lab</Link> |{" "}
          <Link to="/chat">Chat</Link> |{" "}
          <Link to="/experiments">Experiments</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<AutoPilotWizard />} />
        <Route path="/chunking" element={<ChunkingLab />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/experiments" element={<ExperimentMatrix />} />
      </Routes>
    </main>
  );
}
