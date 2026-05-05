/**
 * Top-level shell — four-screen MVP. The visual chrome (header, theme, nav)
 * lives in `Shell`; each route renders one of the four working surfaces.
 */

import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ModalProvider } from "./components/providers/ModalProvider";
import { ToastProvider } from "./components/providers/ToastProvider";
import { AutoPilotWizard } from "./screens/AutoPilotWizard";
import { ChatView } from "./screens/ChatView";
import { ChunkingLab } from "./screens/ChunkingLab";
import { ExperimentMatrix } from "./screens/ExperimentMatrix";
import { ExternalProviders } from "./screens/ExternalProviders";
import { GoldenSets } from "./screens/GoldenSets";
import { Library } from "./screens/Library";

export function App(): JSX.Element {
  return (
    <ModalProvider>
      <ToastProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<AutoPilotWizard />} />
            <Route path="/library" element={<Library />} />
            <Route path="/chunking" element={<ChunkingLab />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/experiments" element={<ExperimentMatrix />} />
            <Route path="/golden-sets" element={<GoldenSets />} />
            <Route path="/providers" element={<ExternalProviders />} />
          </Routes>
        </Shell>
      </ToastProvider>
    </ModalProvider>
  );
}
