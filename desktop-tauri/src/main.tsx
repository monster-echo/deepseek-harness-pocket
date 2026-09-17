import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// 跟随系统明暗：Tauri 窗口没有浏览器 chrome，直接挂到根元素
const mql = window.matchMedia("(prefers-color-scheme: dark)");
const apply = (dark: boolean) =>
  document.documentElement.classList.toggle("dark", dark);
apply(mql.matches);
mql.addEventListener("change", (e) => apply(e.matches));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
