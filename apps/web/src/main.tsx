import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { syncDocumentLanguage } from "./i18n/index.js";
import { AppThemeProvider } from "./theme/ThemeContext.js";
import { setupWebAnalytics } from "./lib/webAnalytics.js";
import { App } from "./App.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// 表示言語 (#352)。決めるのは import 時（i18n/index.ts）で、ここでは
// <html lang> を実際の言語に合わせるだけ
syncDocumentLanguage();

// 閲覧数の計測 (#328)。未設定の環境では何も読み込まない
setupWebAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
