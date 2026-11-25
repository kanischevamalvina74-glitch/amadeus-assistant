import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/primitives.css";
import "./styles/workspace.css";

createRoot(document.getElementById("root")!).render(<App />);
