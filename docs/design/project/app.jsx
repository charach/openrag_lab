// App shell + router + tweaks wiring + modal/toast providers

const { useState, useEffect } = React;

const AppInner = ({ tweak, setTweak, route, setRoute, workspaceId, setWorkspaceId, externalCall, setExternalCall }) => {
  const modal = useModal();
  const toast = useToast();

  const screens = {
    auto: <AutoPilot tweak={tweak} setExternalCall={setExternalCall} setRoute={setRoute} />,
    chunking: <ChunkingLab />,
    chat: <Chat retrievalOnly={tweak.retrievalOnly} externalLLM={tweak.externalLLM} setExternalCall={setExternalCall} />,
    experiments: <ExperimentMatrix />,
    library: <Library />,
  };

  return (
    <>
      <Header
        route={route} setRoute={setRoute}
        workspaceId={workspaceId} setWorkspaceId={setWorkspaceId}
        externalCall={externalCall} testMode={tweak.testMode}
      />
      <div data-screen-label={route} className="fade-in" key={route}>
        {screens[route]}
      </div>
      {/* Demo trigger — always-visible button to surface dim-mismatch + license modals */}
      <DemoModalLauncher />
      <TweaksPanel title="Tweaks">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweak.theme}
            options={[{value:"noir",label:"Noir"},{value:"pearl",label:"Pearl"}]}
            onChange={v => setTweak("theme", v)} />
        </TweakSection>
        <TweakSection title="Chat mode">
          <TweakToggle label="Retrieval-only mode" value={tweak.retrievalOnly} onChange={v => setTweak("retrievalOnly", v)} />
          <TweakToggle label="External LLM (Anthropic)" value={tweak.externalLLM} onChange={v => setTweak("externalLLM", v)} />
        </TweakSection>
        <TweakSection title="Header">
          <TweakToggle label="Show test-mode badge" value={tweak.testMode} onChange={v => setTweak("testMode", v)} />
        </TweakSection>
        <TweakSection title="Navigate">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {["auto","library","chunking","chat","experiments"].map(r => (
              <button key={r} onClick={()=>setRoute(r)} className="btn btn-sm"
                style={{justifyContent:"center", borderColor: route===r?"var(--accent)":undefined}}>
                {r}
              </button>
            ))}
          </div>
        </TweakSection>
        <TweakSection title="Demo modals">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            <button className="btn btn-sm" style={{justifyContent:"center"}} onClick={() => {
              modal.open({
                title: "License agreement", eyebrow: "Model download", width: 540,
                render: LicenseModal({
                  model: { name: "llama-3-8b-q4", licenseId: "Llama 3 Community", size: "4.6 GB", commercial: "yes" },
                  onAccept: () => toast.push({ eyebrow: "Accepted", message: "Download started — 4.6 GB queued." }),
                }),
              });
            }}>License</button>
            <button className="btn btn-sm" style={{justifyContent:"center"}} onClick={() => {
              modal.open({
                title: "Embedder change requires reindex", eyebrow: "Dimension mismatch", width: 520, danger: true,
                render: DimMismatchModal({
                  from: { name: "all-MiniLM-L12", dim: 768 },
                  to: { name: "bge-small-en-v1.5", dim: 384 },
                  archivedCount: 3,
                  onConfirm: () => toast.push({ eyebrow: "Reindexing", message: "Archived 3 experiments. New job queued." }),
                }),
              });
            }}>Dim-mismatch</button>
          </div>
        </TweakSection>
      </TweaksPanel>
    </>
  );
};

const DemoModalLauncher = () => null;

const App = () => {
  const tweaksDefaults = useTweaks(/*EDITMODE-BEGIN*/{
    "theme": "noir",
    "retrievalOnly": false,
    "externalLLM": false,
    "testMode": false,
    "density": "regular"
  }/*EDITMODE-END*/);
  const [tweak, setTweak] = [tweaksDefaults[0], tweaksDefaults[1]];

  const [route, setRoute] = useState("auto");
  const [workspaceId, setWorkspaceId] = useState("ws_a1b2c3");
  const [externalCall, setExternalCall] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tweak.theme || "noir");
  }, [tweak.theme]);

  return (
    <ModalProvider>
      <ToastProvider>
        <AppInner tweak={tweak} setTweak={setTweak}
          route={route} setRoute={setRoute}
          workspaceId={workspaceId} setWorkspaceId={setWorkspaceId}
          externalCall={externalCall} setExternalCall={setExternalCall} />
      </ToastProvider>
    </ModalProvider>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
