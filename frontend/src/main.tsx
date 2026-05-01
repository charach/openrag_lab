import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/tokens.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element missing");

const storedTheme = window.localStorage.getItem("openrag.theme");
document.documentElement.setAttribute(
  "data-theme",
  storedTheme === "pearl" || storedTheme === "noir" ? storedTheme : "noir",
);

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
