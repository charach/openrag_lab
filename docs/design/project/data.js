// Mock state and data for OpenRAG-Lab prototype
// Shaped per API_SPEC_v4.md

window.MOCK = (function() {
  const profile = {
    cpu: { cores: 12, threads: 16, model: "Apple M2 Pro" },
    ram: { total_gb: 32, available_gb: 24 },
    gpu: {
      available: true, vendor: "apple", name: "M2 Pro GPU",
      acceleration_backend: "metal", available_backends: ["metal", "cpu"]
    },
    os: { platform: "darwin", version: "14.5", arch: "arm64" }
  };

  const presets = [
    {
      id: "speed", name: "속도 우선", available: true,
      embedder: "all-MiniLM-L6-v2", dim: 384,
      chunking: "fixed · 256 / 32",
      llm: "local:tinyllama-1.1b-q4",
      rationale: "8GB 미만 GPU 또는 CPU 환경에서 빠른 응답.",
      ramHint: "≈ 4 GB RAM",
    },
    {
      id: "balanced", name: "밸런스", available: true, recommended: true,
      embedder: "BAAI/bge-small-en-v1.5", dim: 384,
      chunking: "recursive · 512 / 64",
      llm: "local:llama-3-8b-q4",
      rationale: "일반적인 PC 환경에서 정확도와 속도의 균형.",
      ramHint: "≈ 12 GB RAM",
    },
    {
      id: "accuracy", name: "정확도 우선", available: true,
      embedder: "BAAI/bge-large-en-v1.5", dim: 1024,
      chunking: "semantic (P1)",
      llm: "local:llama-3-70b-q4",
      rationale: "대형 모델, 시맨틱 청킹, 리랭커 적용.",
      ramHint: "≈ 24 GB RAM",
    },
  ];

  const workspaces = [
    { id: "ws_a1b2c3", name: "변호사 자료실", documents: 12, chunks: 384, experiments: 3, active: true },
    { id: "ws_d4e5f6", name: "사내 매뉴얼 — KO", documents: 287, chunks: 9120, experiments: 8 },
    { id: "ws_g7h8i9", name: "Wikipedia 학습용", documents: 45, chunks: 1402, experiments: 2 },
  ];

  // For Auto-Pilot indexing-in-progress mock
  const indexingFiles = [
    { name: "판례모음_2024.pdf",        size: "8.4 MB",  format: "pdf", status: "embedded", chunks: 142 },
    { name: "임대차보호법_해설.pdf",     size: "2.1 MB",  format: "pdf", status: "embedded", chunks: 64  },
    { name: "주거권_연구노트.md",        size: "108 KB", format: "md",  status: "embedding", chunks: 18, progress: 0.62 },
    { name: "분쟁사례_정리.txt",         size: "412 KB", format: "txt", status: "chunked",  chunks: 0  },
    { name: "case_2024_summary.pdf",   size: "1.7 MB", format: "pdf", status: "queued",   chunks: 0  },
  ];
  const failedFiles = [
    { name: "스캔본_원본.pdf", reason: "PARSE_ENCRYPTED_PDF" },
  ];

  // Chunking Lab — Korean PDF preview chunks
  // Real-feeling Korean text segmented into 18 chunks.
  const chunkingDoc = {
    id: "doc_xyz789",
    filename: "임대차보호법_해설.pdf",
    pages: 84,
  };

  // Each chunk has a content fragment; adjacent chunks alternate gray scale + occasional gold for citation marker
  const chunkPalette = [
    "#3A3A3A", "#5A5A5A", "#7A7468", "#9A9488",
    "#3A3A3A", "#5A5A5A", "#7A7468", "#C8A96A",
  ];

  const previewParagraphs = [
    "주택임대차보호법 제6조의3은 임차인의 계약갱신요구권을 규정하고 있으며, 임대인은 정당한 사유가 없는 한 이를 거절할 수 없다. 본 조문이 신설된 배경에는 임차인의 주거 안정성을 두텁게 보장하려는 입법자의 의도가 자리한다.",
    "갱신 거절의 정당한 사유로는 (1) 임차인이 2기의 차임액에 해당하는 금액에 이르도록 차임을 연체한 사실이 있는 경우, (2) 임차인이 거짓이나 그 밖의 부정한 방법으로 임차한 경우, (3) 서로 합의하여 임대인이 상당한 보상을 제공한 경우 등이 있다.",
    "대법원 2019다XXX 판결은 임대인 본인이 실제로 거주하려는 의사를 입증하지 못한 채 갱신을 거절한 사안에 대해, 당해 거절이 정당한 사유에 해당하지 않는다고 판시하였다. 즉, 실거주 의사의 진정성에 관한 입증책임은 임대인에게 있다.",
    "한편 동일 쟁점에 관한 2020다YYY 판결은 임대인이 갱신 거절 통지 후 6개월 이내에 정당한 사유 없이 제3자에게 목적물을 임대한 경우, 손해배상 책임을 부담한다고 보았다. 손해의 범위는 환산보증금의 3개월분에 상당하는 금액으로 추정된다.",
    "실무상 갱신 거절 분쟁에서 가장 빈번하게 등장하는 쟁점은 ‘재건축·재개발 계획’의 진정성이다. 단순한 노후화 진술만으로는 부족하며, 관할 관청의 인허가 신청 사실 또는 이에 준하는 객관적 증빙이 요구된다.",
    "법원은 임대인이 제출한 재건축 계획서의 형식적 완성도뿐 아니라, 자금 조달 계획·시공사 선정 등 실행 가능성에 관한 정황까지 종합적으로 심사하는 경향이다. 형식적 서류만으로 거절 사유를 인정한 사례는 드물다.",
    "한편 임차인 측에서 갱신 거절에 대한 다툼을 제기할 때는, 거절 통지의 도달 시점과 형식이 주된 절차적 쟁점이 된다. 임대인이 구두 또는 비공식 메시지로 거절 의사를 표시한 경우 그 효력이 부정될 가능성이 높다.",
    "내용증명 우편으로 송부된 거절 통지는 도달 추정의 효력이 있으며, 임차인이 주거 부재로 수령하지 못한 사정만으로는 도달이 부정되지 않는다는 것이 확립된 판례다.",
    "갱신 거절 사유 중 ‘실거주’ 항목은 2020년 개정으로 신설되었으며, 임대인 본인 또는 직계 존비속의 실거주를 모두 포괄한다. 다만 실거주 주체는 통지 시점에 특정되어야 하며, 사후 변경은 허용되지 않는다.",
    "실거주 거절 후 임대인이 정당한 사유 없이 제3자에게 임대한 사실이 적발될 경우, 임차인은 손해배상을 청구할 수 있다. 손해배상의 범위는 갱신 거절 당시의 월차임을 기준으로 산정한다.",
  ];

  // Build 18 chunks (some short, some long) with overlap regions
  const chunks = [];
  let offset = 0;
  for (let i = 0; i < 18; i++) {
    const para = previewParagraphs[i % previewParagraphs.length];
    const len = para.length;
    const tokenEst = Math.round(len * 1.6);
    chunks.push({
      id: "chunk_" + (100 + i),
      sequence: i,
      content: para,
      token_count: tokenEst,
      page: Math.floor(i / 2) + 12,
      color: chunkPalette[i % chunkPalette.length],
      hasOverlap: i > 0,
    });
    offset += len;
  }

  // Chat data
  const question = "이번 분쟁 사례에서 임대차 갱신 거절 사유로 인정된 판례가 있나요? 손해배상 범위까지 정리해 주세요.";
  const answerSegments = [
    { text: "예. ", cite: null },
    { text: "대법원 2019다XXX 판결", cite: 1 },
    { text: "은 임대인이 실거주 의사를 입증하지 못한 채 갱신을 거절한 사안에 대해, 당해 거절을 정당한 사유로 인정하지 않았습니다. 즉, 실거주 의사의 진정성에 관한 ", cite: null },
    { text: "입증책임은 임대인에게 있다", cite: 1 },
    { text: "는 점이 명시되었습니다.\n\n", cite: null },
    { text: "한편 손해배상 범위에 관해서는 ", cite: null },
    { text: "2020다YYY 판결", cite: 2 },
    { text: "이 기준이 됩니다. 임대인이 갱신 거절 통지 후 ", cite: null },
    { text: "6개월 이내에 정당한 사유 없이 제3자에게 목적물을 임대한 경우 손해배상 책임을 부담", cite: 2 },
    { text: "하며, 그 범위는 ", cite: null },
    { text: "환산보증금의 3개월분에 상당하는 금액으로 추정", cite: 2 },
    { text: "됩니다.\n\n실무상으로는 ", cite: null },
    { text: "재건축 계획의 진정성", cite: 3 },
    { text: " 또한 빈번한 쟁점입니다. 법원은 형식적 서류뿐 아니라 자금 조달·시공사 선정 등 ", cite: null },
    { text: "실행 가능성까지 종합적으로 심사", cite: 4 },
    { text: "하는 경향을 보입니다.", cite: null },
  ];

  const retrievedChunks = [
    { id: 1, file: "판례모음_2024.pdf", page: 42, score: 0.91, content: "대법원 2019다XXX 판결은 임대인 본인이 실제로 거주하려는 의사를 입증하지 못한 채 갱신을 거절한 사안에 대해, 당해 거절이 정당한 사유에 해당하지 않는다고 판시하였다. 즉, 실거주 의사의 진정성에 관한 입증책임은 임대인에게 있다." },
    { id: 2, file: "판례모음_2024.pdf", page: 47, score: 0.87, content: "2020다YYY 판결은 임대인이 갱신 거절 통지 후 6개월 이내에 정당한 사유 없이 제3자에게 목적물을 임대한 경우, 손해배상 책임을 부담한다고 보았다. 손해의 범위는 환산보증금의 3개월분에 상당하는 금액으로 추정된다." },
    { id: 3, file: "임대차보호법_해설.pdf", page: 78, score: 0.74, content: "실무상 갱신 거절 분쟁에서 가장 빈번하게 등장하는 쟁점은 ‘재건축·재개발 계획’의 진정성이다. 단순한 노후화 진술만으로는 부족하며, 관할 관청의 인허가 신청 사실 또는 이에 준하는 객관적 증빙이 요구된다." },
    { id: 4, file: "임대차보호법_해설.pdf", page: 79, score: 0.68, content: "법원은 재건축 계획서의 형식적 완성도뿐 아니라, 자금 조달 계획·시공사 선정 등 실행 가능성에 관한 정황까지 종합적으로 심사하는 경향이다." },
  ];

  // Experiments list (left rail in chat & main grid in matrix)
  const experiments = [
    {
      id: "exp_42abcd", fp: "fp_a1b2c3", short: "fp_a1b2",
      preset: "Balanced",
      embedder: "bge-small-en",
      dim: 384,
      chunking: "recursive · 512/64",
      llm: "llama-3-8b-q4",
      retrieval: "dense · k=5",
      status: "completed",
      archived: false,
      scores: { faithfulness: 0.86, answer_relevance: 0.91, context_precision: 0.78, context_recall: 0.82 },
      latency_ms: 4250,
    },
    {
      id: "exp_19eedd", fp: "fp_b4c5d6", short: "fp_b4c5",
      preset: "Lite",
      embedder: "MiniLM-L6",
      dim: 384,
      chunking: "fixed · 256/32",
      llm: "tinyllama-1.1b-q4",
      retrieval: "dense · k=3",
      status: "completed",
      archived: false,
      scores: { faithfulness: 0.71, answer_relevance: 0.79, context_precision: 0.69, context_recall: 0.74 },
      latency_ms: 1820,
    },
    {
      id: "exp_77aacc", fp: "fp_e7f8g9", short: "fp_e7f8",
      preset: "Quality",
      embedder: "bge-large-en",
      dim: 1024,
      chunking: "recursive · 1024/128",
      llm: "llama-3-70b-q4",
      retrieval: "dense · k=8",
      status: "completed",
      archived: false,
      scores: { faithfulness: 0.92, answer_relevance: 0.94, context_precision: 0.85, context_recall: 0.88 },
      latency_ms: 9420,
    },
    {
      id: "exp_55nnoo", fp: "fp_x9y8z7", short: "fp_x9y8",
      preset: "Retrieval-only",
      embedder: "bge-small-en",
      dim: 384,
      chunking: "recursive · 512/64",
      llm: null,
      retrieval: "dense · k=5",
      status: "completed",
      archived: false,
      scores: { faithfulness: null, answer_relevance: null, context_precision: 0.81, context_recall: 0.85 },
      latency_ms: 87,
    },
    {
      id: "exp_archived", fp: "fp_old111", short: "fp_old1",
      preset: "Balanced (old)",
      embedder: "all-MiniLM-L12",
      dim: 768,
      chunking: "fixed · 384/48",
      llm: "llama-3-8b-q4",
      retrieval: "dense · k=5",
      status: "archived",
      archived: true,
      scores: { faithfulness: 0.74, answer_relevance: 0.81, context_precision: 0.71, context_recall: 0.76 },
      latency_ms: 5100,
    },
  ];

  return {
    profile, presets, workspaces,
    indexingFiles, failedFiles,
    chunkingDoc, chunks, previewParagraphs,
    question, answerSegments, retrievedChunks,
    experiments,
  };
})();
