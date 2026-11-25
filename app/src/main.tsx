import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import App from "./App";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./styles/workspace.css";
import "./styles/compact.css";

createRoot(document.getElementById("root")!).render(<App />);
